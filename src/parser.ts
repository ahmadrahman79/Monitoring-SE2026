import { PPLSummary, Table3Record, PPLDailyProgress } from './types';

// Simple but robust CSV line parser that respects double quotes
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// Parses an Indonesian date string (e.g., "19 Juni 2026") into a JS Date object
export function parseIndonesianDate(dateStr: string): Date {
  const cleanStr = dateStr.trim();
  const parts = cleanStr.split(/\s+/);
  if (parts.length < 3) return new Date();
  
  const day = parseInt(parts[0], 10) || 1;
  const monthName = parts[1].toLowerCase();
  const year = parseInt(parts[2], 10) || 2026;
  
  const months: Record<string, number> = {
    januari: 0, jan: 0,
    februari: 1, feb: 1,
    maret: 2, mar: 2,
    april: 3, apr: 3,
    mei: 4,
    juni: 5, jun: 5,
    juli: 6, jul: 6,
    agustus: 7, agt: 7, ags: 7,
    september: 8, sep: 8,
    oktober: 9, okt: 9,
    november: 10, nov: 10,
    desember: 11, des: 11
  };
  
  const month = months[monthName] !== undefined ? months[monthName] : 5; // default to June (Juni)
  return new Date(year, month, day);
}

export interface ParsedModel {
  table1: PPLSummary[];
  table2: PPLSummary[];
  table3: Table3Record[];
  table3Calculated: PPLDailyProgress[];
  pmlList: string[];
  pplList: { name: string; pml: string }[];
  dateList: string[]; // sorted Indonesian date strings
}

// Helper to convert double list representation from Google Sheets API to standard CSV string
export function convertValuesToCSV(values: any[][]): string {
  if (!values || values.length === 0) return '';
  return values.map(row => {
    return row.map(val => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  }).join('\n');
}

// Parse combined Sheets data (rekap + data lama) with target WIB date for active rekap status
export function parseNewSheetsData(
  rekapCSV: string,
  dataLamaCSV: string,
  activeWIBDateStr: string
): ParsedModel {
  const table1: PPLSummary[] = [];
  const table3: Table3Record[] = [];
  
  // 1. Parse rekap (holds active day's entries)
  const rekapLines = rekapCSV.split(/\r?\n/);
  for (let i = 1; i < rekapLines.length; i++) {
    const line = rekapLines[i].trim();
    if (!line) continue;
    
    const rawCols = parseCSVLine(line);
    const cols = rawCols.map(c => c.replace(/^"|"$/g, '').trim());
    
    if (cols.length >= 5 && cols[0] && cols[0] !== 'Nama PML' && cols[1]) {
      let pmlName = cols[0];
      let pplName = cols[1];
      if (pmlName === '#N/A') pmlName = 'Belum Terpetakan';
      if (pplName === '#N/A') pplName = 'Belum Terpetakan';
      
      const submit = parseInt(cols[2], 10) || 0;
      const draft = parseInt(cols[3], 10) || 0;
      const total = parseInt(cols[4], 10) || 0;
      const mempawahTargetValue = cols[5] ? (parseInt(cols[5], 10) || 0) : 0;
      const mempawahTarget = mempawahTargetValue > 0 ? mempawahTargetValue : total;
      
      table1.push({ pmlName, pplName, submit, draft, total, mempawahTarget });
      
      // Add active dynamic snapshot to chronological log
      table3.push({
        pmlName,
        pplName,
        submit,
        draft,
        total,
        mempawahTarget,
        dateStr: activeWIBDateStr,
        date: parseIndonesianDate(activeWIBDateStr)
      });
    }
  }
  
  // Create a map of PPL -> mempawahTarget from rekap for historical lookup
  const pplTargetMap = new Map<string, number>();
  table1.forEach(item => {
    pplTargetMap.set(item.pplName, item.mempawahTarget || item.total);
  });
  
  // 2. Parse data lama (history archive data logs)
  const dataLamaLines = dataLamaCSV.split(/\r?\n/);
  for (let i = 1; i < dataLamaLines.length; i++) {
    const line = dataLamaLines[i].trim();
    if (!line) continue;
    
    const rawCols = parseCSVLine(line);
    const cols = rawCols.map(c => c.replace(/^"|"$/g, '').trim());
    
    if (cols.length >= 6 && cols[0] && cols[0] !== 'Nama PML' && cols[1] && cols[5]) {
      let pmlName = cols[0];
      let pplName = cols[1];
      if (pmlName === '#N/A') pmlName = 'Belum Terpetakan';
      if (pplName === '#N/A') pplName = 'Belum Terpetakan';
      
      const submit = parseInt(cols[2], 10) || 0;
      const draft = parseInt(cols[3], 10) || 0;
      const total = parseInt(cols[4], 10) || 0;
      const dateStr = cols[5];
      
      // De-duplicate: If rekap is already assigned to this dateStr (e.g. today has already been pushed to data lama),
      // let the active "rekap" row take precedence and don't duplicate.
      const isDuplicate = table3.some(item => item.pplName === pplName && item.dateStr === dateStr);
      if (!isDuplicate) {
        const mempawahTarget = pplTargetMap.get(pplName) || total;
        table3.push({
          pmlName,
          pplName,
          submit,
          draft,
          total,
          mempawahTarget,
          dateStr,
          date: parseIndonesianDate(dateStr)
        });
      }
    }
  }
  
  // Calculate daily non-accumulated delta progress for all chronological snapshots grouped by PPL
  const pplRecords: Record<string, Table3Record[]> = {};
  for (const rec of table3) {
    if (!pplRecords[rec.pplName]) {
      pplRecords[rec.pplName] = [];
    }
    pplRecords[rec.pplName].push(rec);
  }
  
  const table3Calculated: PPLDailyProgress[] = [];
  
  for (const pplName in pplRecords) {
    const records = pplRecords[pplName];
    // Sort chronological progress
    records.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    for (let i = 0; i < records.length; i++) {
      const curr = records[i];
      let dailySubmit = 0;
      let dailyDraft = 0;
      let dailyTotal = 0;
      let isFirstDay = false;
      
      if (i === 0) {
        dailySubmit = curr.submit;
        dailyDraft = curr.draft;
        dailyTotal = curr.total;
        isFirstDay = true;
      } else {
        const prev = records[i - 1];
        dailySubmit = curr.submit - prev.submit;
        dailyDraft = curr.draft - prev.draft;
        dailyTotal = curr.total - prev.total;
      }
      
      table3Calculated.push({
        ...curr,
        dailySubmit,
        dailyDraft,
        dailyTotal,
        isFirstDay
      });
    }
  }
  
  // Create unique sets and lists
  const pmlsSet = new Set<string>();
  const pplsMap = new Map<string, string>(); // PPL - PML mapping
  const datesSet = new Set<string>();
  const datesParsedMap = new Map<string, Date>();
  
  table3Calculated.forEach(rec => {
    pmlsSet.add(rec.pmlName);
    pplsMap.set(rec.pplName, rec.pmlName);
    datesSet.add(rec.dateStr);
    datesParsedMap.set(rec.dateStr, rec.date);
  });
  
  const pmlList = Array.from(pmlsSet).sort();
  const pplList = Array.from(pplsMap.entries()).map(([name, pml]) => ({ name, pml })).sort((a, b) => a.name.localeCompare(b.name));
  
  // Sort Indonesian date strings chronologically
  const dateList = Array.from(datesSet).sort((a, b) => {
    const dateA = datesParsedMap.get(a) || new Date(0);
    const dateB = datesParsedMap.get(b) || new Date(0);
    return dateA.getTime() - dateB.getTime();
  });
  
  return {
    table1,
    table2: [],
    table3,
    table3Calculated,
    pmlList,
    pplList,
    dateList
  };
}

export function parseSpreadsheetCSV(csvText: string): ParsedModel {
  // Retaining fallback signature, wrapping empty mock or simple parse
  return parseNewSheetsData(csvText, '', '21 Juni 2026');
}

