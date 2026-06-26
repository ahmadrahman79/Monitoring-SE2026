import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import cron from "node-cron";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { parseNewSheetsData } from './src/parser';
import fs from 'fs';

// Helper to get Western Indonesian Time (WIB, UTC+7)
function getCurrentWIB(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + (3600000 * 7));
}

// Helper to get active dynamic Indonesian date string
function getWIBTargetDateStr(): string {
  const wib = getCurrentWIB();
  const h = wib.getHours();
  const m = wib.getMinutes();

  const isAfter2359 = (h === 23 && m >= 59);
  if (isAfter2359) {
    wib.setDate(wib.getDate() + 1);
  }

  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return `${wib.getDate()} ${months[wib.getMonth()]} ${wib.getFullYear()}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Read Firebase config from JSON
  const firebaseConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
  const firebaseApp = initializeApp(firebaseConfig);
  const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

  // Setup cron job at 23:59 WIB every day
  cron.schedule('59 23 * * *', async () => {
    console.log('[CRON] Executing auto snapshot sync at 23:59 WIB');
    try {
      const SPREADSHEET_ID = '1UC5Ca8EAj088IhFigDHy-106ijc0k_YGlGUHkVzU2Vs';
      const REKAP_SHEET = 'rekap';
      const DATA_LAMA_SHEET = 'data lama';
      
      const rekapUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(REKAP_SHEET)}`;
      const dataLamaUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(DATA_LAMA_SHEET)}`;

      const [rekapRes, dataLamaRes] = await Promise.all([
        fetch(rekapUrl),
        fetch(dataLamaUrl)
      ]);

      if (!rekapRes.ok || !dataLamaRes.ok) {
        throw new Error("Gagal mengunduh spreadsheet");
      }

      const [rekapText, dataLamaText] = await Promise.all([
        rekapRes.text(),
        dataLamaRes.text()
      ]);

      if (rekapText.trim().startsWith('<!doctype') || dataLamaText.trim().startsWith('<!doctype')) {
         throw new Error("Akses dibatasi ke spreadsheet privat");
      }

      const activeWIBDateStr = getWIBTargetDateStr();
      const parsedData = parseNewSheetsData(rekapText, dataLamaText, activeWIBDateStr, []);

      if (parsedData.table1.length === 0) {
        console.log('[CRON] No rekap data available to sync');
        return;
      }

      const batch = writeBatch(db);
      
      parsedData.table1.forEach(rec => {
        const pmlNameClean = rec.pmlName.replace(/\//g, '_').replace(/ /g, '_');
        const pplNameClean = rec.pplName.replace(/\//g, '_').replace(/ /g, '_');
        const dateStrClean = activeWIBDateStr.replace(/ /g, '_');
        const id = `${dateStrClean}_${pmlNameClean}_${pplNameClean}`;
        
        const docRef = doc(collection(db, 'daily_logs'), id);
        
        batch.set(docRef, {
          dateStr: activeWIBDateStr,
          pmlName: rec.pmlName,
          pplName: rec.pplName,
          submit: rec.submit,
          draft: rec.draft,
          total: rec.total,
          target: rec.mempawahTarget || 0,
          updatedAt: serverTimestamp(),
          cronSecret: '9q8w7e6r5t4y3u2i1o' // Our secret key in firestore rules
        });
      });

      await batch.commit();
      console.log('[CRON] Snapshot synced successfully');
    } catch (err) {
      console.error('[CRON] Snapshot sync failed', err);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Jakarta"
  });

  // API route for healthcheck
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
