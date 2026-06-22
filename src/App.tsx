import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  RefreshCw, 
  Search, 
  Filter, 
  TrendingUp, 
  Users, 
  Info, 
  AlertCircle, 
  Clock, 
  ChevronDown, 
  Database,
  ArrowRight,
  TrendingDown,
  Sparkles,
  Sheet,
  LogOut,
  Github,
  Calendar,
  LineChart as LucideLineChart
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  Line,
  ComposedChart
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { initAuth, googleSignIn, logout } from './firebase';
import { parseNewSheetsData, convertValuesToCSV } from './parser';
import { PPLSummary, Table3Record, PPLDailyProgress } from './types';
import { User } from 'firebase/auth';

const SPREADSHEET_ID = '1UC5Ca8EAj088IhFigDHy-106ijc0k_YGlGUHkVzU2Vs';
const REKAP_SHEET = 'rekap';
const DATA_LAMA_SHEET = 'data lama';

// Helper to get Western Indonesian Time (WIB, UTC+7)
function getCurrentWIB(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + (3600000 * 7));
}

// Calculate the elapsed days of data collection.
// June 22, 2026 is Day 7, so the start of data collection is June 16, 2026.
function getCurrentDayOfPendataan(): number {
  const startDate = new Date(2026, 5, 16); // 16 Juni 2026
  const today = getCurrentWIB();
  // Reset time fields to compare exact calendar UTC days
  const utcStart = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const utcToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((utcToday - utcStart) / (1000 * 60 * 60 * 24));
  const elapsed = diffDays + 1;
  return elapsed >= 7 ? elapsed : 7; // As instructed, June 22 is Day 7, minimum is 7.
}

// Calculate precise remaining days to Kabupaten Mempawah target buffer deadline (August 15, 2026)
function getRemainingDaysToMempawahDeadline(): number {
  const today = getCurrentWIB();
  today.setHours(0,0,0,0);
  
  const targetDate = new Date(2026, 7, 15); // 15 Agustus 2026 (7 is August in 0-indexed JS date month representation)
  targetDate.setHours(0,0,0,0);
  
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays > 0 ? diffDays : 1;
}

// Helper to get active dynamic Indonesian date string with 23:59 WIB daily cutoff
function getWIBTargetDateStr(): string {
  const wib = getCurrentWIB();
  const h = wib.getHours();
  const m = wib.getMinutes();

  // If time exceeds 23:59 (so exactly 23:59:00 or later of standard day), we roll over to the next day
  const isAfter2359 = (h === 23 && m >= 59);

  const target = new Date(wib);
  if (isAfter2359) {
    target.setDate(target.getDate() + 1);
  }

  const d = target.getDate();
  const y = target.getFullYear();
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return `${d} ${months[target.getMonth()]} ${y}`;
}

const FALLBACK_REKAP_CSV = `"Nama PML","Nama PPL","Submit","Draf","Total"
"Sulis Tri Handayani","Eva Lutfianti","68","22","90"
"Sulis Tri Handayani","Sri Ratna Dewi","56","0","56"
"Sulis Tri Handayani","Suci Pratiwi","23","25","48"
"Sulis Tri Handayani","Laras Nanda Julita","38","1","39"
"Sulis Tri Handayani","Arie Maulana","19","0","19"
"Sulis Tri Handayani","Fuulanah Aniskurlillah","17","3","20"
"Sulis Tri Handayani","Nafisah Ismatul Faizah","11","1","12"
"Sulis Tri Handayani","Triesna Dinda Saputra","21","22","43"
"Ridha Nur Mitha","Dwi Febrianti","31","3","34"
"Ridha Nur Mitha","Bagus Setiawan","29","18","47"
"Ridha Nur Mitha","Vivi Yatul Islamiah","40","15","55"
"Ridha Nur Mitha","Rika","35","18","53"
"Ridha Nur Mitha","Tri Ramadianti","39","36","75"
"Ridha Nur Mitha","Muhammad Fredi Ramschie, St","50","10","60"
"Ridha Nur Mitha","Ismail","23","1","24"
"Ridha Nur Mitha","Ridhawati","16","21","37"`;

const FALLBACK_DATA_LAMA_CSV = `"Nama PML","Nama PPL","Submit","Draf","Total","Tanggal update"
"Sulis Tri Handayani","Arie Maulana","13","0","13","19 Juni 2026"
"Sulis Tri Handayani","Arie Maulana","17","0","17","20 Juni 2026"
"Sulis Tri Handayani","Arie Maulana","19","0","19","21 Juni 2026"
"Ridha Nur Mitha","Bagus Setiawan","24","10","34","19 Juni 2026"
"Ridha Nur Mitha","Bagus Setiawan","28","14","42","20 Juni 2026"
"Ridha Nur Mitha","Bagus Setiawan","29","18","47","21 Juni 2026"
"Ridha Nur Mitha","Dwi Febrianti","26","1","27","19 Juni 2026"
"Ridha Nur Mitha","Dwi Febrianti","28","1","29","20 Juni 2026"
"Ridha Nur Mitha","Dwi Febrianti","31","3","34","21 Juni 2026"
"Sulis Tri Handayani","Eva Lutfianti","37","15","52","19 Juni 2026"
"Sulis Tri Handayani","Eva Lutfianti","54","27","81","20 Juni 2026"
"Sulis Tri Handayani","Eva Lutfianti","68","22","90","21 Juni 2026"
"Sulis Tri Handayani","Fuulanah Aniskurlillah","10","2","12","19 Juni 2026"
"Sulis Tri Handayani","Fuulanah Aniskurlillah","14","2","16","20 Juni 2026"
"Sulis Tri Handayani","Fuulanah Aniskurlillah","17","3","20","21 Juni 2026"
"Ridha Nur Mitha","Ismail","11","0","11","19 Juni 2026"
"Ridha Nur Mitha","Ismail","11","0","11","20 Juni 2026"
"Ridha Nur Mitha","Ismail","23","1","24","21 Juni 2026"
"Sulis Tri Handayani","Laras Nanda Julita","21","0","21","19 Juni 2026"
"Sulis Tri Handayani","Laras Nanda Julita","32","0","32","20 Juni 2026"
"Sulis Tri Handayani","Laras Nanda Julita","38","1","39","21 Juni 2026"
"Ridha Nur Mitha","Muhammad Fredi Ramschie, St","16","3","19","19 Juni 2026"
"Ridha Nur Mitha","Muhammad Fredi Ramschie, St","17","29","46","20 Juni 2026"
"Ridha Nur Mitha","Muhammad Fredi Ramschie, St","50","10","60","21 Juni 2026"
"Sulis Tri Handayani","Nafisah Ismatul Faizah","8","1","9","19 Juni 2026"
"Sulis Tri Handayani","Nafisah Ismatul Faizah","9","1","10","20 Juni 2026"
"Sulis Tri Handayani","Nafisah Ismatul Faizah","11","1","12","21 Juni 2026"
"Ridha Nur Mitha","Ridhawati","8","3","11","19 Juni 2026"
"Ridha Nur Mitha","Ridhawati","6","10","16","20 Juni 2026"
"Ridha Nur Mitha","Ridhawati","16","21","37","21 Juni 2026"
"Ridha Nur Mitha","Rika","20","15","35","19 Juni 2026"
"Ridha Nur Mitha","Rika","23","12","35","20 Juni 2026"
"Ridha Nur Mitha","Rika","35","18","53","21 Juni 2026"
"Sulis Tri Handayani","Sri Ratna Dewi","29","0","29","19 Juni 2026"
"Sulis Tri Handayani","Sri Ratna Dewi","43","0","43","20 Juni 2026"
"Sulis Tri Handayani","Sri Ratna Dewi","56","0","56","21 Juni 2026"
"Sulis Tri Handayani","Suci Pratiwi","24","3","27","19 Juni 2026"
"Sulis Tri Handayani","Suci Pratiwi","23","13","36","20 Juni 2026"
"Sulis Tri Handayani","Suci Pratiwi","23","25","48","21 Juni 2026"
"Ridha Nur Mitha","Tri Ramadianti","18","23","41","19 Juni 2026"
"Ridha Nur Mitha","Tri Ramadianti","16","20","36","20 Juni 2026"
"Ridha Nur Mitha","Tri Ramadianti","39","36","75","21 Juni 2026"
"Sulis Tri Handayani","Triesna Dinda Saputra","2","14","16","19 Juni 2026"
"Sulis Tri Handayani","Triesna Dinda Saputra","21","21","42","20 Juni 2026"
"Sulis Tri Handayani","Triesna Dinda Saputra","21","22","43","21 Juni 2026"
"Ridha Nur Mitha","Vivi Yatul Islamiah","23","11","34","19 Juni 2026"
"Ridha Nur Mitha","Vivi Yatul Islamiah","27","26","53","20 Juni 2026"
"Ridha Nur Mitha","Vivi Yatul Islamiah","40","15","55","21 Juni 2026"`;

export default function App() {
  // Authentication states (removed as requested)
  const user = null;
  const accessToken = null;
  const isLoggingIn = false;

  // App data states
  const [rekapCSV, setRekapCSV] = useState<string>(FALLBACK_REKAP_CSV);
  const [dataLamaCSV, setDataLamaCSV] = useState<string>(FALLBACK_DATA_LAMA_CSV);
  const [isLiveLoading, setIsLiveLoading] = useState<boolean>(false);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [lastUpdate, setLastUpdate] = useState<string>('2026-06-21 23:59:00');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Clock for real-time WIB displays
  const [currentWIBTime, setCurrentWIBTime] = useState<Date>(getCurrentWIB());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentWIBTime(getCurrentWIB());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filters State
  const [selectedPml, setSelectedPml] = useState<string>('ALL');
  const [selectedPpl, setSelectedPpl] = useState<string>('ALL');
  const [selectedDate, setSelectedDate] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTablePml, setSelectedTablePml] = useState<string>('ALL');
  const [bottomTablePage, setBottomTablePage] = useState<number>(1);
  const [dailyLogPage, setDailyLogPage] = useState<number>(1);
  const [targetTrackerPpl, setTargetTrackerPpl] = useState<string>('');
  const [localPplFilter, setLocalPplFilter] = useState<string>('');
  const [isTrackerDropdownOpen, setIsTrackerDropdownOpen] = useState<boolean>(false);
  const [trackerSearchInput, setTrackerSearchInput] = useState<string>('');

  const trackerDropdownRef = useRef<HTMLDivElement>(null);

  // Sync tracker search input when active value updates
  useEffect(() => {
    if (targetTrackerPpl) {
      setTrackerSearchInput(targetTrackerPpl);
    }
  }, [targetTrackerPpl]);

  // Click outside tracker dropdown to close it
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (trackerDropdownRef.current && !trackerDropdownRef.current.contains(event.target as Node)) {
        setIsTrackerDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // UI Table Tab Tab
  const [tableTab, setTableTab] = useState<'daily' | 'cumulative'>('daily');
  const [leaderboardTab, setLeaderboardTab] = useState<'most' | 'least'>('most');

  // Reset page sizes on filter change
  useEffect(() => {
    setBottomTablePage(1);
  }, [selectedTablePml]);

  useEffect(() => {
    setDailyLogPage(1);
  }, [selectedPml, selectedPpl, selectedDate, searchQuery, tableTab]);

  // Fetch method for multiple sheets (rekap & data lama)
  const fetchSheetData = async (silent = false, tokenOverride?: string | null) => {
    if (!silent) {
       setIsLiveLoading(true);
    }
    setErrorMsg(null);

    const token = tokenOverride !== undefined ? tokenOverride : accessToken;

    try {
      if (token) {
        // Use standard Google Sheets API v4 for multiple sheets in parallel
        const sheetsHeader = { 'Authorization': `Bearer ${token}` };
        const rekapUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/rekap`;
        const dataLamaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(DATA_LAMA_SHEET)}`;

        const [rekapRes, dataLamaRes] = await Promise.all([
          fetch(rekapUrl, { headers: sheetsHeader }),
          fetch(dataLamaUrl, { headers: sheetsHeader })
        ]);

        if (!rekapRes.ok || !dataLamaRes.ok) {
          if (rekapRes.status === 401 || rekapRes.status === 403 || dataLamaRes.status === 401 || dataLamaRes.status === 403) {
            throw new Error("Akses Ditolak: Token G-Login Kedaluwarsa. Silakan Login kembali.");
          }
          throw new Error(`Google Sheets API responded with error status (${rekapRes.status} atau ${dataLamaRes.status})`);
        }

        const [rekapJson, dataLamaJson] = await Promise.all([
          rekapRes.json(),
          dataLamaRes.json()
        ]);

        if (!rekapJson.values || !dataLamaJson.values) {
          throw new Error("Format data di dokumen spreadsheet kosong atau salah.");
        }

        const rekapText = convertValuesToCSV(rekapJson.values);
        const dataLamaText = convertValuesToCSV(dataLamaJson.values);

        setRekapCSV(rekapText);
        setDataLamaCSV(dataLamaText);
        setIsLive(true);
      } else {
        // Fallback: Google Visualization API CSV trick for public view
        const rekapUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(REKAP_SHEET)}`;
        const dataLamaUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(DATA_LAMA_SHEET)}`;

        const [rekapRes, dataLamaRes] = await Promise.all([
          fetch(rekapUrl),
          fetch(dataLamaUrl)
        ]);

        if (!rekapRes.ok || !dataLamaRes.ok) {
          throw new Error("Gagal mengunduh spreadsheet. Aturlah izin pelihat menjadi 'Siapa saja yang memiliki link'.");
        }

        const [rekapText, dataLamaText] = await Promise.all([
          rekapRes.text(),
          dataLamaRes.text()
        ]);

        if (rekapText.trim().startsWith('<!doctype') || dataLamaText.trim().startsWith('<!doctype')) {
          throw new Error("Akses dibatasi ke spreadsheet privat. Silakan tekan tombol G-Login untuk sinkronisasi.");
        }

        setRekapCSV(rekapText);
        setDataLamaCSV(dataLamaText);
        setIsLive(true);
      }

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const datestamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setLastUpdate(datestamp);
    } catch (err: any) {
      console.error("Live fetch error:", err);
      setErrorMsg(`Sinkronisasi Gagal: ${err.message || 'Koneksi bermasalah'}`);
    } finally {
      setIsLiveLoading(false);
    }
  };

  // Trigger initial fetch
  useEffect(() => {
    fetchSheetData();
  }, []);

  // Set up auto-refresh timer (30 minutes)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSheetData(true);
    }, 1800000);
    return () => clearInterval(interval);
  }, []);

  // Parsed combined Sheets (rekap + data lama)
  const parsedData = useMemo(() => {
    const activeWIBDate = getWIBTargetDateStr();
    return parseNewSheetsData(rekapCSV, dataLamaCSV, activeWIBDate);
  }, [rekapCSV, dataLamaCSV]);

  // Handle PML filter change
  const handlePmlChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedPml(val);
    setSelectedPpl('ALL'); // Reset PPL selection to avoid mismatch
  };

  // Filter list of PPL dynamically depending on selected PML
  const filteredPplList = useMemo(() => {
    if (selectedPml === 'ALL') {
      return parsedData.pplList;
    }
    return parsedData.pplList.filter(item => item.pml === selectedPml);
  }, [selectedPml, parsedData.pplList]);

  // Synchronously initialize the default PPL for the Mempawah tracker card and sync with the active PML selection
  useEffect(() => {
    if (parsedData.pplList.length > 0) {
      if (!targetTrackerPpl) {
        setTargetTrackerPpl(parsedData.pplList[0].name);
      } else if (selectedPml !== 'ALL') {
        const pplsInPml = parsedData.pplList.filter(item => item.pml === selectedPml);
        const currentStillValid = pplsInPml.some(item => item.name === targetTrackerPpl);
        if (!currentStillValid && pplsInPml.length > 0) {
          setTargetTrackerPpl(pplsInPml[0].name);
        }
      }
    }
  }, [parsedData.pplList, targetTrackerPpl, selectedPml]);

  // Apply selectors (PML, PPL, Date, Search Query) to the calculated daily deltas
  const processedRecords = useMemo(() => {
    let records = [...parsedData.table3Calculated];

    // Search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      records = records.filter(item => 
        item.pplName.toLowerCase().includes(query) || 
        item.pmlName.toLowerCase().includes(query)
      );
    }

    // PML filter
    if (selectedPml !== 'ALL') {
      records = records.filter(item => item.pmlName === selectedPml);
    }

    // PPL filter
    if (selectedPpl !== 'ALL') {
      records = records.filter(item => item.pplName === selectedPpl);
    }

    // Date filter
    if (selectedDate !== 'ALL') {
      records = records.filter(item => item.dateStr === selectedDate);
    }

    // Sort Chronologically descending
    records.sort((a, b) => b.date.getTime() - a.date.getTime());

    return records;
  }, [parsedData.table3Calculated, selectedPml, selectedPpl, selectedDate, searchQuery]);

  // Paginated daily logs
  const paginatedProcessedRecords = useMemo(() => {
    const startIndex = (dailyLogPage - 1) * 10;
    return processedRecords.slice(startIndex, startIndex + 10);
  }, [processedRecords, dailyLogPage]);

  const totalDailyLogPages = useMemo(() => {
    return Math.ceil(processedRecords.length / 10) || 1;
  }, [processedRecords]);

  // Metrics KPI calculations
  const metricsKPIs = useMemo(() => {
    // We compute:
    // 1. AccumSubmit & AccumDraft from the latest state inside the matched filters 
    const filteredRecordSet = parsedData.table3Calculated.filter(rec => {
      if (selectedPml !== 'ALL' && rec.pmlName !== selectedPml) return false;
      if (selectedPpl !== 'ALL' && rec.pplName !== selectedPpl) return false;
      if (selectedDate !== 'ALL' && rec.dateStr !== selectedDate) return false;
      return true;
    });

    const pplLatestMap = new Map<string, PPLDailyProgress>();
    filteredRecordSet.forEach(rec => {
      const existing = pplLatestMap.get(rec.pplName);
      if (!existing || rec.date.getTime() > existing.date.getTime()) {
        pplLatestMap.set(rec.pplName, rec);
      }
    });

    let totalCumSubmit = 0;
    let totalCumDraft = 0;
    let totalCumTotal = 0;
    let totalCumMempawahTarget = 0;

    pplLatestMap.forEach(rec => {
      totalCumSubmit += rec.submit;
      totalCumDraft += rec.draft;
      totalCumTotal += rec.total;
      totalCumMempawahTarget += rec.mempawahTarget || rec.total;
    });

    // Sum of non-accumulated daily additions within filtered records
    let totalDailySubmit = 0;
    let totalDailyDraft = 0;
    let totalDailyTotal = 0;

    filteredRecordSet.forEach(rec => {
      totalDailySubmit += rec.dailySubmit;
      totalDailyDraft += rec.dailyDraft;
      totalDailyTotal += rec.dailyTotal;
    });

    return {
      cumSubmit: totalCumSubmit,
      cumDraft: totalCumDraft,
      cumTotal: totalCumTotal,
      cumMempawahTarget: totalCumMempawahTarget,
      dailySubmit: totalDailySubmit,
      dailyDraft: totalDailyDraft,
      dailyTotal: totalDailyTotal,
      pplCount: pplLatestMap.size
    };
  }, [parsedData.table3Calculated, selectedPml, selectedPpl, selectedDate]);

  // Find most active PPL based on average daily submits
  const mostActivePpl = useMemo(() => {
    const submitMap: Record<string, number> = {};
    parsedData.table3Calculated.forEach(rec => {
      submitMap[rec.pplName] = (submitMap[rec.pplName] || 0) + rec.dailySubmit;
    });

    let topName = "Tidak ada";
    let topAvg = 0;
    let topSum = 0;

    const elapsedDays = getCurrentDayOfPendataan();

    Object.entries(submitMap).forEach(([name, val]) => {
      const avg = val / elapsedDays;
      if (avg > topAvg) {
        topAvg = avg;
        topName = name;
        topSum = val;
      }
    });

    return {
      name: topName,
      submits: topSum,
      avg: parseFloat(topAvg.toFixed(2)),
      initials: topName.split(' ').map(p => p.charAt(0)).join('').substring(0, 2).toUpperCase()
    };
  }, [parsedData.table3Calculated]);

  // Chart data: Tren harian grouped by date
  const trendChartData = useMemo(() => {
    const dates: Record<string, { dateStr: string; dateObj: Date; SUBMIT: number; DRAFT: number }> = {};
    
    parsedData.table3Calculated.forEach(rec => {
      if (selectedPml !== 'ALL' && rec.pmlName !== selectedPml) return;
      if (selectedPpl !== 'ALL' && rec.pplName !== selectedPpl) return;

      if (!dates[rec.dateStr]) {
        dates[rec.dateStr] = {
          dateStr: rec.dateStr,
          dateObj: rec.date,
          SUBMIT: 0,
          DRAFT: 0
        };
      }
      dates[rec.dateStr].SUBMIT += rec.dailySubmit;
      dates[rec.dateStr].DRAFT += rec.dailyDraft;
    });

    return Object.values(dates).sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
  }, [parsedData.table3Calculated, selectedPml, selectedPpl]);

  // Live PPL sidebar list stats representation - sorted by average daily submits
  const livePplList = useMemo(() => {
    const ppls: Record<string, { name: string; pmlName: string; submit: number; draft: number; days: number; submitAvg: number }> = {};
    parsedData.table3Calculated.forEach(rec => {
      if (selectedPml !== 'ALL' && rec.pmlName !== selectedPml) return;

      if (!ppls[rec.pplName]) {
        ppls[rec.pplName] = {
          name: rec.pplName,
          pmlName: rec.pmlName,
          submit: 0,
          draft: 0,
          days: 0,
          submitAvg: 0
        };
      }
      // Sum daily contribution
      ppls[rec.pplName].submit += rec.dailySubmit;
      ppls[rec.pplName].draft += rec.dailyDraft;
      ppls[rec.pplName].days += 1;
    });

    const elapsedDays = getCurrentDayOfPendataan();

    Object.values(ppls).forEach(p => {
      p.submitAvg = parseFloat((p.submit / elapsedDays).toFixed(2));
    });

    return Object.values(ppls).sort((a, b) => b.submitAvg - a.submitAvg || b.submit - a.submit);
  }, [parsedData.table3Calculated, selectedPml]);

  // Handle local searching of PPL within the Detail Per PPL card
  const filteredLivePplList = useMemo(() => {
    if (!localPplFilter.trim()) return livePplList;
    const query = localPplFilter.toLowerCase().trim();
    return livePplList.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.pmlName.toLowerCase().includes(query)
    );
  }, [livePplList, localPplFilter]);

  // Dynamic PML Groups for bottom recap comparison card tables
  const pmlGroups = useMemo<Record<string, { pplName: string; submit: number; draft: number; total: number; progress: number; mempawahTarget: number }[]>>(() => {
    const groups: Record<string, { pplName: string; submit: number; draft: number; total: number; progress: number; mempawahTarget: number }[]> = {};
    
    // Group table data by PML name
    parsedData.table3Calculated.forEach(rec => {
      if (!groups[rec.pmlName]) {
        groups[rec.pmlName] = [];
      }
      // Check if already exist for this date
      const groupList = groups[rec.pmlName];
      const existing = groupList.find(p => p.pplName === rec.pplName);
      
      const recMempawahTarget = rec.mempawahTarget || rec.total;
      if (!existing) {
        groupList.push({
          pplName: rec.pplName,
          submit: rec.submit,
          draft: rec.draft,
          total: rec.total,
          mempawahTarget: recMempawahTarget,
          progress: recMempawahTarget > 0 ? parseFloat(((rec.submit / recMempawahTarget) * 100).toFixed(1)) : 0
        });
      } else {
        // Keeps the latest/maximum record
        if (rec.total > existing.total) {
          existing.submit = rec.submit;
          existing.draft = rec.draft;
          existing.total = rec.total;
          existing.mempawahTarget = recMempawahTarget;
          existing.progress = recMempawahTarget > 0 ? parseFloat(((rec.submit / recMempawahTarget) * 100).toFixed(1)) : 0;
        }
      }
    });

    return groups;
  }, [parsedData.table3Calculated]);

  // Calculate Sub Totals for each PML group
  const pmlSubTotals = useMemo(() => {
    const totals: Record<string, { submit: number; draft: number; total: number; mempawahTarget: number; progress: number }> = {};
    (Object.entries(pmlGroups) as [string, { pplName: string; submit: number; draft: number; total: number; progress: number; mempawahTarget: number }[]][]).forEach(([pmlName, list]) => {
      let subSubmit = 0;
      let subDraft = 0;
      let subTotal = 0;
      let subMempawahTarget = 0;
      list.forEach(item => {
        subSubmit += item.submit;
        subDraft += item.draft;
        subTotal += item.total;
        subMempawahTarget += item.mempawahTarget || item.total;
      });
      totals[pmlName] = {
        submit: subSubmit,
        draft: subDraft,
        total: subTotal,
        mempawahTarget: subMempawahTarget,
        progress: subMempawahTarget > 0 ? parseFloat(((subSubmit / subMempawahTarget) * 100).toFixed(1)) : 0
      };
    });
    return totals;
  }, [pmlGroups]);

  // Combine and sort data for the unified bottom table, filtered dynamically by selectedTablePml
  const bottomTableData = useMemo(() => {
    const list: { pmlName: string; pplName: string; submit: number; draft: number; total: number; progress: number; mempawahTarget: number }[] = [];
    (Object.entries(pmlGroups) as [string, { pplName: string; submit: number; draft: number; total: number; progress: number; mempawahTarget: number }[]][]).forEach(([pmlName, ppls]) => {
      if (selectedTablePml !== 'ALL' && pmlName !== selectedTablePml) {
        return;
      }
      ppls.forEach(ppl => {
        list.push({
          pmlName,
          ...ppl
        });
      });
    });
    // Sort by PML Name, then by PPL Name
    return list.sort((a, b) => a.pmlName.localeCompare(b.pmlName) || a.pplName.localeCompare(b.pplName));
  }, [pmlGroups, selectedTablePml]);

  // Paginated bottom table data
  const paginatedBottomTableData = useMemo(() => {
    const startIndex = (bottomTablePage - 1) * 10;
    return bottomTableData.slice(startIndex, startIndex + 10);
  }, [bottomTableData, bottomTablePage]);

  const totalBottomTablePages = useMemo(() => {
    return Math.ceil(bottomTableData.length / 10) || 1;
  }, [bottomTableData]);

  // Target tracker helper for any selected PPL in Mempawah Deadline
  const selectedPplTrackerInfo = useMemo(() => {
    if (!targetTrackerPpl) return null;
    
    // Find in pmlGroups across all PMLs (unfiltered)
    const entries = Object.entries(pmlGroups) as [string, { pplName: string; submit: number; draft: number; total: number; progress: number; mempawahTarget: number }[]][];
    for (const [pmlName, list] of entries) {
      const found = list.find(p => p.pplName === targetTrackerPpl);
      if (found) {
        return {
          pmlName,
          pplName: found.pplName,
          submit: found.submit,
          draft: found.draft,
          total: found.total,
          progress: found.progress,
          mempawahTarget: found.mempawahTarget
        };
      }
    }
    return null;
  }, [pmlGroups, targetTrackerPpl]);

  // Combined totals for the unified bottom table
  const bottomTableTotals = useMemo(() => {
    let submit = 0;
    let draft = 0;
    let total = 0;
    let mempawahTarget = 0;
    bottomTableData.forEach(item => {
      submit += item.submit;
      draft += item.draft;
      total += item.total;
      mempawahTarget += item.mempawahTarget || item.total;
    });
    const progress = mempawahTarget > 0 ? parseFloat(((submit / mempawahTarget) * 100).toFixed(1)) : 0;
    return { submit, draft, total, mempawahTarget, progress };
  }, [bottomTableData]);

  // Find top star PPL for each PML team based on average daily submit
  const teamStars = useMemo(() => {
    const pmlToPplSubmits: Record<string, Record<string, { totalVal: number; days: number }>> = {};
    
    parsedData.table3Calculated.forEach(rec => {
      // If we are filtering by date, respect that date
      if (selectedDate !== 'ALL' && rec.dateStr !== selectedDate) return;
      
      if (!pmlToPplSubmits[rec.pmlName]) {
        pmlToPplSubmits[rec.pmlName] = {};
      }
      if (!pmlToPplSubmits[rec.pmlName][rec.pplName]) {
        pmlToPplSubmits[rec.pmlName][rec.pplName] = { totalVal: 0, days: 0 };
      }
      pmlToPplSubmits[rec.pmlName][rec.pplName].totalVal += rec.dailySubmit;
      pmlToPplSubmits[rec.pmlName][rec.pplName].days += 1;
    });

    const elapsedDays = selectedDate === 'ALL' ? getCurrentDayOfPendataan() : 1;

    const stars: { pmlName: string; pplName: string; submits: number; avg: number; initials: string }[] = [];
    Object.entries(pmlToPplSubmits).forEach(([pmlName, pplMap]) => {
      let topPpl = "";
      let maxAvg = -1;
      let totalSub = 0;
      
      Object.entries(pplMap).forEach(([pplName, data]) => {
        const avg = data.totalVal / elapsedDays;
        if (avg > maxAvg) {
          maxAvg = avg;
          topPpl = pplName;
          totalSub = data.totalVal;
        }
      });
      
      if (topPpl && maxAvg >= 0) {
        const initials = topPpl
          .split(' ')
          .filter(Boolean)
          .map(p => p.charAt(0))
          .join('')
          .substring(0, 2)
          .toUpperCase() || 'P';
          
        stars.push({
          pmlName,
          pplName: topPpl,
          submits: totalSub,
          avg: parseFloat(maxAvg.toFixed(2)),
          initials
        });
      }
    });

    // Only return top 3 stars with highest average submits
    return [...stars].sort((a, b) => b.avg - a.avg || b.submits - a.submits).slice(0, 3);
  }, [parsedData.table3Calculated, selectedDate]);

  // Compute live leaderboard lists (Paling Produktif vs Paling Tidak Produktif) harian/filter - berdasarkan rata-rata
  const leaderboardList = useMemo(() => {
    const ppls: Record<string, { pplName: string; pmlName: string; submits: number; drafts: number; daysCount: number; submitsAvg: number; draftsAvg: number }> = {};
    
    parsedData.table3Calculated.forEach(rec => {
      if (selectedDate !== 'ALL' && rec.dateStr !== selectedDate) return;
      if (selectedPml !== 'ALL' && rec.pmlName !== selectedPml) return;

      if (!ppls[rec.pplName]) {
        ppls[rec.pplName] = {
          pplName: rec.pplName,
          pmlName: rec.pmlName,
          submits: 0,
          drafts: 0,
          daysCount: 0,
          submitsAvg: 0,
          draftsAvg: 0
        };
      }
      ppls[rec.pplName].submits += rec.dailySubmit;
      ppls[rec.pplName].drafts += rec.dailyDraft;
      ppls[rec.pplName].daysCount += 1;
    });

    const elapsedDays = selectedDate === 'ALL' ? getCurrentDayOfPendataan() : 1;

    Object.values(ppls).forEach(item => {
      item.submitsAvg = parseFloat((item.submits / elapsedDays).toFixed(2));
      item.draftsAvg = parseFloat((item.drafts / elapsedDays).toFixed(2));
    });

    const arr = Object.values(ppls);
    
    // Sort logic: priority average submits first
    const mostProductive = [...arr].sort((a, b) => b.submitsAvg - a.submitsAvg || b.draftsAvg - a.draftsAvg || b.submits - a.submits);
    const leastProductive = [...arr].sort((a, b) => a.submitsAvg - b.submitsAvg || a.draftsAvg - b.draftsAvg || a.submits - b.submits);

    return { mostProductive, leastProductive };
  }, [parsedData.table3Calculated, selectedDate, selectedPml]);

  // Selected list of officers for active leaderboard
  const activeLeaderboard = useMemo(() => {
    return leaderboardTab === 'most' ? leaderboardList.mostProductive : leaderboardList.leastProductive;
  }, [leaderboardList, leaderboardTab]);

  return (
    <div className="flex flex-col min-h-screen bg-slate-50 font-sans text-slate-900">
      
      {/* Top Header Section */}
      <header className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0 gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded text-white flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2"></path>
            </svg>
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-800">
              Monitoring Progres Pendataan Lapangan
            </h1>
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 font-medium">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0"></span> 
              Terhubung dengan Google Sheets: Rekap Progres Lapangan
            </p>
          </div>
        </div>

        {/* Dynamic header widgets */}
        <div className="flex flex-wrap items-center gap-2 text-xs self-end sm:self-auto">
          <div className="flex flex-col items-end mr-2 text-right">
            <span className="text-slate-400 text-[10px] uppercase font-bold">Update Terakhir</span>
            <span className="font-mono font-bold text-slate-700">{lastUpdate}</span>
          </div>
          
          <select 
            value={selectedPml} 
            onChange={handlePmlChange}
            className="bg-white border border-slate-350 rounded px-2 py-1 text-xs outline-hidden font-medium text-slate-700 cursor-pointer hover:border-slate-400"
          >
            <option value="ALL">PML: Semua Tim</option>
            {parsedData.pmlList.map(pml => (
              <option key={pml} value={pml}>{`PML: ${pml}`}</option>
            ))}
          </select>

          <button 
            onClick={() => fetchSheetData(false)}
            disabled={isLiveLoading}
            id="sync-now-btn"
            className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer flex items-center gap-1"
          >
            <RefreshCw size={12} className={isLiveLoading ? "animate-spin" : ""} />
            <span>Sync Now</span>
          </button>

          <a 
            href="https://github.com/ahmadrahman79/Monitoring-SE2026"
            target="_blank"
            rel="noopener noreferrer"
            id="github-repo-btn"
            className="bg-slate-800 text-white px-3 py-1.5 rounded text-xs font-semibold hover:bg-slate-900 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Github size={12} />
            <span>GitHub Repository</span>
          </a>

        </div>
      </header>

      {/* Warning banner */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-amber-50 border-b border-amber-205 text-amber-900 px-4 py-2 text-xs font-medium flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={14} className="text-amber-600" />
              <span>{errorMsg}</span>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-[10px] uppercase font-bold text-slate-500 hover:text-slate-900">
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content Grid with dynamic layout spacing */}
      <main className="flex-1 p-4 grid grid-cols-12 gap-4">

        {/* Info Explainer ribbon */}
        <div className="col-span-12 bg-blue-50/50 border border-blue-200/50 p-2.5 rounded-lg flex items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-blue-600 flex-shrink-0" />
            <p className="text-slate-600 font-medium">
              Aplikasi menghitung <b>Harian (Non-Akumulasi)</b> murni dengan membandingkan entri tanggal berurutan dari Google Sheet.
            </p>
          </div>
          <span className="text-[10px] bg-blue-100 text-blue-800 font-sans font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Smart Delta Mode
          </span>
        </div>

        {/* WIB 23:59 Cutoff Panel */}
        <div className="col-span-12 bg-slate-900 text-white p-4 rounded-xl border border-slate-800 hover:border-slate-750 transition-all shadow-md flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-lg shrink-0">
              <Clock size={20} className="animate-pulse" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase font-black tracking-widest text-[#00E5FF]">WIB Timed Pipeline</span>
                <span className="text-[9px] bg-slate-800 text-slate-300 font-bold px-2 py-0.5 rounded border border-slate-700">Autocommit WIB 23:59 Cutoff</span>
              </div>
              <h3 className="text-xs sm:text-sm font-bold mt-1 text-slate-100">
                Alokasi Tanggal Aktif: <span className="text-[#00E5FF] font-black">{getWIBTargetDateStr()}</span>
              </h3>
              <p className="text-[11px] text-slate-450 mt-0.5 font-medium leading-relaxed">
                Waktu WIB Online: <span className="font-mono text-cyan-200 font-bold">{currentWIBTime.toLocaleTimeString('id-ID', { hour12: false })} WIB</span>.
                {currentWIBTime.getHours() === 23 && currentWIBTime.getMinutes() >= 55 ? (
                  <span className="text-rose-400 ml-1.5 font-bold animate-pulse">⚠️ Perhatian: mendekati cutoff 23:59 WIB harian!</span>
                ) : (
                  <span className="text-slate-400 ml-1.5 font-sans font-medium">Entri yang di-update setelah pukul 23:59 WIB otomatis dikelompokkan ke tanggal berikutnya.</span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Dynamic Filter Row */}
        <div className="col-span-12 bg-white border border-slate-205 p-3 rounded-lg flex flex-wrap gap-3 items-center justify-between shadow-2xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Filter size={11} /> Filter:
            </span>

            {/* PPL Selector */}
            <select
              value={selectedPpl}
              onChange={(e) => setSelectedPpl(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs outline-hidden font-medium text-slate-700 cursor-pointer"
            >
              <option value="ALL">Semua PPL (Petugas)</option>
              {filteredPplList.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>

            {/* Date Selector */}
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs outline-hidden font-medium text-slate-700 cursor-pointer"
            >
              <option value="ALL">Semua Tanggal</option>
              {parsedData.dateList.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Cari PPL / PML..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded pl-7 pr-2.5 py-1 text-xs text-slate-700 outline-hidden focus:border-blue-600 focus:bg-white w-48 transition-colors"
              />
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Reset Filters */}
          {(selectedPml !== 'ALL' || selectedPpl !== 'ALL' || selectedDate !== 'ALL' || searchQuery !== '') && (
            <button
              onClick={() => {
                setSelectedPml('ALL');
                setSelectedPpl('ALL');
                setSelectedDate('ALL');
                setSearchQuery('');
              }}
              className="text-xs text-red-600 hover:text-red-700 font-semibold bg-red-50 hover:bg-red-100 rounded px-2.5 py-1 transition-colors cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>
        
        {/* KPI Bar */}
        <div className="col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: Total Submit */}
          <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col justify-between shadow-2xs h-24">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Total Submit (Hari Ini / Filter)</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-green-600">
                {metricsKPIs.dailySubmit >= 0 ? `+${metricsKPIs.dailySubmit}` : metricsKPIs.dailySubmit}
              </span>
              <span className="text-[11px] text-slate-400 font-medium">berkas dari {metricsKPIs.pplCount} PPL</span>
            </div>
            <div className="text-[10px] text-slate-400 font-semibold uppercase flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Kontribusi Bersih Harian
            </div>
          </div>

          {/* Card 2: Total Draft */}
          <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col justify-between shadow-2xs h-24">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Total Draft (Hari Ini)</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-amber-500">{metricsKPIs.dailyDraft}</span>
              <span className="text-[11px] text-slate-400 font-medium">perlu re-review</span>
            </div>
            <div className="text-[10px] text-slate-450 font-semibold uppercase flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span> Status draft temporer
            </div>
          </div>

          {/* Card 3: Target Completion Progress */}
          <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col justify-between shadow-2xs h-24">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Akumulasi Progres Target</span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-xl font-black text-slate-800">{metricsKPIs.cumSubmit}</span>
              <span className="text-xs text-blue-600 font-extrabold bg-blue-50 px-1.5 py-0.5 rounded">
                {metricsKPIs.cumMempawahTarget > 0 ? ((metricsKPIs.cumSubmit / metricsKPIs.cumMempawahTarget) * 100).toFixed(1) : '0'}% Selesai
              </span>
            </div>
            <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
              <div 
                className="bg-blue-600 h-full transition-all duration-500" 
                style={{ width: `${metricsKPIs.cumMempawahTarget > 0 ? Math.min((metricsKPIs.cumSubmit / metricsKPIs.cumMempawahTarget) * 100, 100) : 0}%` }}
              ></div>
            </div>
          </div>
          {/* Card 4: Most Active Officer PPL */}
          <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col justify-between shadow-2xs h-24">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">PPL Paling Aktif (Submit)</span>
            <div className="flex items-center gap-2.5 mt-1">
              <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-black text-xs shrink-0 border border-indigo-200 shadow-2xs">
                {mostActivePpl.initials}
              </div>
              <div className="flex flex-col leading-tight min-w-0">
                <span className="text-xs font-extrabold text-slate-800 truncate">{mostActivePpl.name}</span>
                <span className="text-[10px] text-green-600 font-bold">Rerata: {mostActivePpl.avg} / hari</span>
              </div>
            </div>
            <div className="text-[9px] text-indigo-500 font-bold uppercase tracking-wider mt-1">Productivity Winner</div>
          </div>
        </div>

        {/* Kabupaten Mempawah Buffer Deadline Tracker */}
        <div className="col-span-12 bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] bg-red-50 border border-red-200 text-red-700 font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  Buffer Target Kabupaten Mempawah
                </span>
                <span className="text-[10px] bg-slate-100 border border-slate-200 text-slate-700 font-sans font-extrabold px-2.5 py-0.5 rounded-full uppercase">
                  Deadline: 15 Agustus 2026
                </span>
              </div>
              <h2 className="text-lg font-black mt-1.5 text-slate-800 tracking-tight flex items-center gap-2">
                🎯 Pelacak Target Harian Petugas (Akselerasi Tepat Waktu)
              </h2>
              <p className="text-slate-500 text-xs mt-0.5 font-medium">Hitung mundur sisa hari kerja hingga target penyelesaian buffer tanggal 15 Agustus 2026.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0 bg-slate-50 border border-slate-200 rounded-lg p-3 shadow-3xs">
              <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                <Calendar size={18} />
              </div>
              <div className="text-left font-sans min-w-[110px]">
                <div className="text-[9px] text-slate-400 uppercase font-black tracking-wider">Sisa Hari Kerja</div>
                <div className="text-base font-black font-mono text-orange-600">{getRemainingDaysToMempawahDeadline()} Hari Lagi</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 mt-4">
            {/* Control Form Column */}
            <div className="md:col-span-5 flex flex-col justify-center gap-2.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Pilih Nama Petugas (PPL) Anda:</label>
              <div className="relative" ref={trackerDropdownRef}>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Cari & pilih nama PPL..."
                    value={trackerSearchInput}
                    onChange={(e) => {
                      setTrackerSearchInput(e.target.value);
                      setIsTrackerDropdownOpen(true);
                    }}
                    onFocus={() => {
                      setIsTrackerDropdownOpen(true);
                    }}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 rounded px-2.5 py-1.5 pl-8 text-xs text-slate-800 font-bold outline-hidden focus:border-orange-500 focus:ring-1 focus:ring-orange-500/10 transition-all shadow-3xs"
                  />
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => setIsTrackerDropdownOpen(!isTrackerDropdownOpen)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <ChevronDown size={14} className={`transition-transform duration-200 ${isTrackerDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {/* Dropdown Options List Container */}
                <AnimatePresence>
                  {isTrackerDropdownOpen && (() => {
                    const filteredPpls = parsedData.pplList.filter(ppl => {
                      if (selectedPml !== 'ALL' && ppl.pml !== selectedPml) return false;
                      const q = trackerSearchInput.toLowerCase().trim();
                      if (!q) return true;
                      return ppl.name.toLowerCase().includes(q) || ppl.pml.toLowerCase().includes(q);
                    });

                    return (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
                      >
                        {filteredPpls.length > 0 ? (
                          filteredPpls.map(ppl => (
                            <button
                              key={ppl.name}
                              type="button"
                              onClick={() => {
                                setTargetTrackerPpl(ppl.name);
                                setTrackerSearchInput(ppl.name);
                                setIsTrackerDropdownOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs flex justify-between items-center transition-colors hover:bg-slate-50 border-b border-slate-100 last:border-0 ${
                                targetTrackerPpl === ppl.name ? 'bg-orange-50 hover:bg-orange-50/80 text-orange-700 font-extrabold' : 'text-slate-700 font-semibold'
                              }`}
                            >
                              <span className="truncate">{ppl.name}</span>
                              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded-sm font-bold ml-2 ${
                                targetTrackerPpl === ppl.name ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'
                              }`}>
                                PML: {ppl.pml}
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="p-3 text-center text-xs text-slate-400 font-medium">
                            Petugas tidak ditemukan
                          </div>
                        )}
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed font-semibold">
                Silakan ketik atau cari dan pilih nama PPL Anda di atas untuk melihat status progres dari target rekap mandiri (Kolom F Google Sheet) secara tepat waktu.
              </p>
            </div>

            {/* Calculations Outcome Column */}
            <div className="md:col-span-7 bg-slate-50 border border-slate-100 p-4 rounded-lg flex flex-col justify-between shadow-3xs">
              {selectedPplTrackerInfo ? (() => {
                const targetLimit = selectedPplTrackerInfo.mempawahTarget || selectedPplTrackerInfo.total || 0;
                const submitted = selectedPplTrackerInfo.submit || 0;
                const remainingTarget = Math.max(0, targetLimit - submitted);
                const remainingDays = getRemainingDaysToMempawahDeadline();
                const dailyRequired = remainingTarget > 0 ? Math.ceil(remainingTarget / remainingDays) : 0;
                const progressPct = targetLimit > 0 ? parseFloat(((submitted / targetLimit) * 100).toFixed(1)) : 0;

                return (
                  <div className="space-y-3.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div>
                        <div className="text-sm font-black text-slate-800">{selectedPplTrackerInfo.pplName}</div>
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Supervisor PML: {selectedPplTrackerInfo.pmlName}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] text-slate-400 font-black uppercase tracking-wider">Progres Target Buffer</div>
                        <div className="text-xs font-extrabold text-orange-600 font-mono">{progressPct}%</div>
                      </div>
                    </div>

                    {/* Horizontal Progress Bar */}
                    <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden shadow-inner">
                      <div 
                        className="bg-linear-to-r from-orange-400 to-amber-500 h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, progressPct)}%` }}
                      />
                    </div>

                    {/* Breakdowns Row */}
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-white p-2.5 rounded border border-slate-150 shadow-3xs">
                        <div className="text-[8px] text-slate-400 uppercase font-black tracking-widest leading-none">Mempawah Target</div>
                        <div className="text-sm font-extrabold text-slate-800 font-mono mt-1">{targetLimit}</div>
                      </div>
                      <div className="bg-white p-2.5 rounded border border-slate-150 shadow-3xs">
                        <div className="text-[8px] text-slate-400 uppercase font-black tracking-widest leading-none">Telah Submit</div>
                        <div className="text-sm font-extrabold text-emerald-600 font-mono mt-1">{submitted}</div>
                      </div>
                      <div className="bg-white p-2.5 rounded border border-slate-150 shadow-3xs">
                        <div className="text-[8px] text-slate-400 uppercase font-black tracking-widest leading-none">Sisa Dokumen</div>
                        <div className="text-sm font-extrabold text-red-500 font-mono mt-1">{remainingTarget}</div>
                      </div>
                    </div>

                    {/* Calculated required daily rate big badge */}
                    <div className="bg-orange-50/60 border border-orange-100 p-3 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-center sm:text-left">
                      <div>
                        <span className="text-[10px] uppercase font-black tracking-wider text-orange-850 block">Target Submit Hari Ini</span>
                        <span className="text-[10px] text-slate-500 font-semibold">Minimal disubmit agar selesai maksimal 15 Agustus 2026</span>
                      </div>
                      {remainingTarget > 0 ? (
                        <div className="bg-slate-900 text-white shrink-0 font-mono px-3.5 py-1.5 rounded-lg border border-slate-800 text-center shadow-xs">
                          <span className="text-lg font-black">{dailyRequired}</span>
                          <span className="text-[9px] text-slate-300 block font-sans font-extrabold uppercase tracking-wider">Dokumen / Hari</span>
                        </div>
                      ) : (
                        <div className="bg-emerald-600 text-white font-black text-xs font-sans px-3.5 py-1.5 rounded-lg animate-bounce transform uppercase tracking-wider shrink-0 shadow-xs">
                          Selesai Target! 🎉
                        </div>
                      )}
                    </div>
                  </div>
                );
              })() : (
                <div className="flex items-center justify-center p-8 text-slate-450 text-xs font-bold">
                  Memuat data pelacak target petugas...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Dynamic Team Stars Appreciation & Leaderboard Rank */}
        <div className="col-span-12 grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* Apresiasi Bintang Tim */}
          <div className="lg:col-span-5 bg-white p-4 rounded-lg border border-slate-200 flex flex-col shadow-2xs">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-100">
              <h2 className="text-xs sm:text-sm font-bold flex items-center gap-2 text-slate-800">
                <Sparkles size={14} className="text-amber-500 fill-amber-500" />
                Apresiasi Bintang Tim (Top PPL per PML)
              </h2>
              <span className="text-[9px] bg-amber-50 text-amber-700 font-extrabold px-2 py-0.5 rounded border border-amber-100 uppercase tracking-widest">
                {selectedDate === 'ALL' ? 'Semua Tanggal' : selectedDate}
              </span>
            </div>
            
            <div className="flex-1 flex flex-col justify-center gap-3">
              {teamStars.length > 0 ? (
                teamStars.map((star) => (
                  <div key={star.pmlName} className="p-3 bg-gradient-to-r from-amber-500/5 to-yellow-500/5 border border-amber-100 rounded-lg flex items-center justify-between gap-3 relative overflow-hidden">
                    <div className="absolute right-2 top-2 text-amber-500/5 select-none pointer-events-none">
                      <Sparkles size={48} />
                    </div>
                    
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-amber-100 border-2 border-amber-200 rounded-full flex items-center justify-center text-amber-700 font-black text-xs shrink-0 shadow-2xs">
                        {star.initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider truncate">{`Tim PML: ${star.pmlName}`}</p>
                        <h4 className="text-xs font-black text-slate-850 truncate">{star.pplName}</h4>
                        <p className="text-[10px] text-slate-500 font-medium">Bintang produktivitas tim</p>
                      </div>
                    </div>
                    
                    <div className="text-right shrink-0">
                      <span className="text-[11px] bg-amber-100 text-amber-850 font-black px-2.5 py-1 rounded border border-amber-200 shadow-3xs block font-mono">
                        Rerata: {star.avg}/hari
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-6 text-slate-400 text-xs font-semibold flex flex-col items-center justify-center gap-2">
                  <Sparkles size={24} className="text-slate-300" />
                  <span>Tidak ada data kontribusi untuk menghitung Bintang Tim.</span>
                </div>
              )}
            </div>
          </div>

          {/* Leaderboard Produktivitas Terurut */}
          <div className="lg:col-span-7 bg-white p-4 rounded-lg border border-slate-200 flex flex-col shadow-2xs">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 pb-2 border-b border-slate-100 gap-2">
              <div>
                <h2 className="text-xs sm:text-sm font-bold flex items-center gap-2 text-slate-800">
                  <TrendingUp size={14} className={leaderboardTab === 'most' ? "text-emerald-600" : "text-rose-500"} />
                  Peringkat Produktivitas Petugas (Leaderboard)
                </h2>
                <p className="text-[9px] text-slate-550 font-semibold leading-none">Berdasarkan rata-rata submit harian dalam rentang waktu filter aktif</p>
              </div>
              
              <div className="flex bg-slate-100/80 p-0.5 rounded border border-slate-200 text-[10px] font-bold shrink-0 self-end sm:self-auto">
                <button
                  onClick={() => setLeaderboardTab('most')}
                  className={`px-3 py-1 rounded cursor-pointer transition-all ${leaderboardTab === 'most' ? 'bg-white text-emerald-600 shadow-3xs border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Terproduktif 🚀
                </button>
                <button
                  onClick={() => setLeaderboardTab('least')}
                  className={`px-3 py-1 rounded cursor-pointer transition-all ${leaderboardTab === 'least' ? 'bg-white text-rose-600 shadow-3xs border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  Kurang Produktif ⚠️
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[170px] space-y-1.5 pr-1 scrollbar-thin">
              {activeLeaderboard.length > 0 ? (
                activeLeaderboard.map((item, idx) => {
                  const maxSubmitsAvg = Math.max(...leaderboardList.mostProductive.map(i => i.submitsAvg), 1);
                  const pct = Math.min((item.submitsAvg / maxSubmitsAvg) * 100, 100);
                  
                  return (
                    <div key={item.pplName} className="p-2 bg-slate-50 border border-slate-100 rounded-md flex items-center justify-between gap-3 text-xs hover:border-slate-200 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className="w-5 text-center font-mono font-bold text-slate-400">#{idx + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between mb-1 gap-1">
                            <span className="font-extrabold text-slate-800 truncate">{item.pplName}</span>
                            <span className="text-[9px] text-slate-450 truncate font-semibold">{item.pmlName}</span>
                          </div>
                          {/* Mini Progress Bar */}
                          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all duration-305 ${leaderboardTab === 'most' ? 'bg-emerald-500' : 'bg-rose-400'}`} 
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right shrink-0 pl-1 font-mono font-bold text-[11px] whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${item.submitsAvg >= 10 ? 'bg-emerald-50 text-emerald-700 border border-emerald-150' : item.submitsAvg > 0 ? 'bg-blue-50 text-blue-700 border border-blue-150' : 'bg-slate-100 text-slate-500'}`}>
                          Avg: {item.submitsAvg}/hari
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs">
                  Tidak ada data untuk menyusun peringkat.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mid Section: Charts & Performance list side-by-side */}
        <div className="col-span-12 lg:col-span-8 bg-white p-4 rounded-lg border border-slate-200 flex flex-col shadow-2xs min-h-[360px]">
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
            <h2 className="text-xs sm:text-sm font-bold flex items-center gap-2 text-slate-800">
              <span className="w-1.5 h-4 bg-blue-600 rounded-full"></span>
              Tren Progres Harian (Non-Akumulasi)
            </h2>
            <div className="flex gap-4 text-[10px] font-bold text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-green-500 rounded-xs"></span> SUBMIT
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-amber-400 rounded-xs"></span> DRAFT
              </div>
            </div>
          </div>
          
          {/* Visual Recharts Bar & Lines Chart */}
          <div className="flex-1 min-h-[260px] w-full">
            {trendChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="dateStr" 
                    tick={{ fill: '#64748b', fontSize: 10, fontWeight: 'bold' }} 
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fill: '#64748b', fontSize: 10 }} 
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'white', borderRadius: '6px', border: '1px solid #e2e8f0' }}
                    labelStyle={{ fontWeight: 'bold', color: '#1e293b', fontSize: '11px' }}
                  />
                  <Legend verticalAlign="top" height={28} iconSize={8} wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                  <Bar name="Submit Baru (Delta)" dataKey="SUBMIT" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={30} />
                  <Bar name="Draf Baru (Delta)" dataKey="DRAFT" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={30} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2.5">
                <LucideLineChart size={32} className="text-slate-300" />
                <p className="text-xs font-semibold">Tidak ada data tren dalam jangkauan filter.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right side lists of PPL detailed progress */}
        <div className="col-span-12 lg:col-span-4 bg-white p-4 rounded-lg border border-slate-200 flex flex-col shadow-2xs h-[360px]">
          <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-100">
            <h2 className="text-xs sm:text-sm font-bold flex items-center gap-2 text-slate-800">
              <span className="w-1.5 h-4 bg-orange-500 rounded-full"></span>
              Detail Per PPL (Real-time Delta)
            </h2>
            <span className="text-[9px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-sm font-bold">PPL: {filteredLivePplList.length}/{filteredPplList.length}</span>
          </div>

          {/* Real-time search filter for PPL */}
          <div className="relative mb-3">
            <input 
              type="text"
              placeholder="Cari PPL di list ini..."
              value={localPplFilter}
              onChange={(e) => setLocalPplFilter(e.target.value)}
              className="w-full bg-slate-50 hover:bg-slate-100/50 focus:bg-white border border-slate-200 rounded px-2.5 py-1.5 pl-8 text-xs text-slate-755 outline-hidden focus:border-orange-500 focus:ring-1 focus:ring-orange-500/10 transition-all shadow-3xs"
            />
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            {localPplFilter && (
              <button 
                onClick={() => setLocalPplFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold font-sans text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Styled List element */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {filteredLivePplList.length > 0 ? (
              filteredLivePplList.map(ppl => (
                <div key={ppl.name} className="p-2.5 bg-slate-50 border border-slate-100 rounded-md flex justify-between items-center text-xs hover:border-slate-300 transition-colors">
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-extrabold text-slate-800 truncate">{ppl.name}</span>
                    <span className="text-[9px] text-slate-500 font-semibold">{ppl.pmlName}</span>
                  </div>
                  <div className="text-right flex-shrink-0 font-mono font-bold text-[11px] space-x-2">
                    <span className="text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-100">S: {ppl.submit}</span>
                    <span className="text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">D: {ppl.draft}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs py-6 gap-2">
                <Search size={18} className="text-slate-300" />
                <span>Tidak ada data PPL yang cocok.</span>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Section: Unified Akumulasi Table with PML Filter */}
        <div className="col-span-12 bg-white rounded-lg border border-slate-200 flex flex-col shadow-2xs overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-705 uppercase flex items-center gap-2">
                <Users size={15} className="text-blue-600" />
                Table Akumulasi Progres Petugas (Per PML)
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">Informasi menyeluruh penyelesaian target untuk seluruh tim lapangan berdasarkan rekap terkini</p>
            </div>
            
            <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 bg-white border border-slate-200 rounded px-3 py-1.5 text-xs shadow-3xs">
              <Filter size={13} className="text-slate-400" />
              <span className="font-bold text-slate-600">Pilih Supervisor PML:</span>
              <select 
                value={selectedTablePml} 
                onChange={(e) => setSelectedTablePml(e.target.value)}
                className="font-bold text-slate-800 bg-transparent outline-none cursor-pointer border-none"
              >
                <option value="ALL">Semua PML</option>
                {parsedData.pmlList.map(pml => (
                  <option key={pml} value={pml}>{pml}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-150">
                <tr className="text-slate-500 uppercase tracking-wider font-extrabold text-[10px]">
                  <th className="p-3 pl-4 text-center w-12">No</th>
                  <th className="p-3">PML Supervisor</th>
                  <th className="p-3">Nama PPL</th>
                  <th className="p-3 text-center">Submit</th>
                  <th className="p-3 text-center">Draft</th>
                  <th className="p-3 text-center">Target (Kolom F)</th>
                  <th className="p-3 text-right pr-6">Progres (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                {paginatedBottomTableData.length > 0 ? (
                  paginatedBottomTableData.map((ppl, index) => (
                    <tr key={ppl.pplName} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-2.5 pl-4 text-center text-slate-400 font-sans">{index + 1 + (bottomTablePage - 1) * 10}</td>
                      <td className="p-2.5 font-sans font-bold text-slate-600">{ppl.pmlName}</td>
                      <td className="p-2.5 font-sans font-semibold text-slate-800">{ppl.pplName}</td>
                      <td className="p-2.5 text-center font-bold text-slate-800">{ppl.submit}</td>
                      <td className="p-2.5 text-center text-slate-400">{ppl.draft}</td>
                      <td className="p-2.5 text-center">{ppl.mempawahTarget}</td>
                      <td className="p-2.5 text-right pr-6 font-bold text-blue-600">
                        <div className="inline-flex items-center gap-1.5 justify-end w-full">
                          <span className="text-[11px] font-bold text-slate-700">{ppl.progress}%</span>
                          <div className="w-12 bg-slate-100 rounded-full h-1.5 overflow-hidden hidden sm:block">
                            <div 
                              className="bg-blue-600 h-full rounded-full"
                              style={{ width: `${Math.min(100, ppl.progress)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400 font-sans">
                      Tidak ada data akumulasi petugas untuk filter PML terpilih.
                    </td>
                  </tr>
                )}
                
                {/* Granular Table totals row at bottom */}
                {bottomTableData.length > 0 && (
                  <tr className="bg-blue-50/40 font-bold border-t border-blue-100">
                    <td colSpan={3} className="p-3 pl-4 font-black font-sans uppercase text-slate-700">
                      TOTAL {selectedTablePml === 'ALL' ? 'TIM GABUNGAN' : `TIM ${selectedTablePml.toUpperCase()}`}
                    </td>
                    <td className="p-3 text-center font-black text-slate-800">{bottomTableTotals.submit}</td>
                    <td className="p-3 text-center font-black text-slate-400">{bottomTableTotals.draft}</td>
                    <td className="p-3 text-center text-slate-700 font-black">{bottomTableTotals.mempawahTarget}</td>
                    <td className="p-3 text-right pr-6 font-black text-blue-700 font-sans">
                      <span className="font-extrabold text-blue-700 inline-block px-1.5 py-0.5 rounded bg-blue-100/50">{bottomTableTotals.progress}%</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {bottomTableData.length > 0 && (
            <div className="p-3 bg-slate-50/70 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-500 font-semibold">
              <div>
                Menampilkan <span className="text-slate-800 font-bold">{(bottomTablePage - 1) * 10 + 1}</span> - <span className="text-slate-800 font-bold">{Math.min(bottomTablePage * 10, bottomTableData.length)}</span> dari <span className="text-slate-800 font-bold">{bottomTableData.length}</span> petugas
              </div>
              <div className="flex gap-1.5">
                <button
                  disabled={bottomTablePage === 1}
                  onClick={() => setBottomTablePage(prev => Math.max(1, prev - 1))}
                  className="px-2.5 py-1 bg-white border border-slate-250 rounded hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-755 font-bold transition-all disabled:cursor-not-allowed cursor-pointer"
                >
                  Sebelumnya
                </button>
                <div className="flex items-center px-1 text-slate-700 font-sans font-bold text-[11px]">
                  Halaman {bottomTablePage} / {totalBottomTablePages}
                </div>
                <button
                  disabled={bottomTablePage === totalBottomTablePages}
                  onClick={() => setBottomTablePage(prev => Math.min(totalBottomTablePages, prev + 1))}
                  className="px-2.5 py-1 bg-white border border-slate-250 rounded hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-755 font-bold transition-all disabled:cursor-not-allowed cursor-pointer"
                >
                  Selanjutnya
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Global interactive delta or cumulative table log summary */}
        <div className="col-span-12 bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs mt-4">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <Sheet size={13} className="text-blue-600" />
                Catatan Harian Kontribusi Lapangan Petugas
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">Log aktivitas komparatif per tanggal pengumpulan data</p>
            </div>
            
            {/* View Table Tab switcher */}
            <div className="flex bg-slate-200/60 p-0.5 rounded-lg text-xs self-start sm:self-auto shrink-0">
              <button
                onClick={() => setTableTab('daily')}
                className={`px-3 py-1 rounded font-bold transition-all cursor-pointer ${tableTab === 'daily' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Harian (Pasif Delta)
              </button>
              <button
                onClick={() => setTableTab('cumulative')}
                className={`px-3 py-1 rounded font-bold transition-all cursor-pointer ${tableTab === 'cumulative' ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Kumulatif (Akumulasi)
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/55 border-b border-slate-200 text-slate-500 uppercase font-extrabold text-[10px]">
                  <th className="p-3 pl-4">Tanggal Update</th>
                  <th className="p-3">Supervisor (PML)</th>
                  <th className="p-3">Petugas (PPL)</th>
                  <th className="p-3 text-center">SUBMIT</th>
                  <th className="p-3 text-center">DRAFT</th>
                  <th className="p-3 text-center">TOTAL</th>
                  <th className="p-3 text-center pr-4">Status Siklus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                {paginatedProcessedRecords.length > 0 ? (
                  paginatedProcessedRecords.map((item, index) => {
                    const isSubmitPositive = tableTab === 'daily' ? item.dailySubmit > 0 : item.submit > 0;
                    return (
                      <tr key={`${item.pplName}-${item.dateStr}-${index}`} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-3 pl-4 whitespace-nowrap font-sans font-medium text-slate-600">{item.dateStr}</td>
                        <td className="p-3 whitespace-nowrap font-sans font-semibold text-slate-850">{item.pmlName}</td>
                        <td className="p-3 whitespace-nowrap font-sans font-bold text-slate-800">{item.pplName}</td>
                        
                        {/* Values toggle dynamically */}
                        {tableTab === 'daily' ? (
                          <>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <span className="font-extrabold text-green-600 font-mono">
                                  {item.dailySubmit > 0 ? `+${item.dailySubmit}` : item.dailySubmit}
                                </span>
                                {item.dailySubmit >= 10 ? (
                                  <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded font-sans font-bold whitespace-nowrap shadow-3xs">
                                    Submit Tinggi (≥10)
                                  </span>
                                ) : (
                                  <span className="text-[9px] bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.5 rounded font-sans font-bold whitespace-nowrap shadow-3xs">
                                    {"Submit Rendah (<10)"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <span className={`font-extrabold font-mono ${item.dailyDraft > 0 ? 'text-amber-500' : item.dailyDraft < 0 ? 'text-slate-400' : 'text-slate-500'}`}>
                                  {item.dailyDraft > 0 ? `+${item.dailyDraft}` : item.dailyDraft}
                                </span>
                                {item.dailyDraft >= 10 ? (
                                  <span className="text-[9px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded font-sans font-bold whitespace-nowrap shadow-3xs">
                                    Draf Tinggi (≥10)
                                  </span>
                                ) : (
                                  <span className="text-[9px] bg-rose-100 text-rose-800 border border-rose-300 px-1.5 py-0.5 rounded font-sans font-bold whitespace-nowrap shadow-3xs">
                                    {"Draf Rendah (<10)"}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-center font-black text-blue-600 font-mono">
                              {item.dailyTotal > 0 ? `+${item.dailyTotal}` : item.dailyTotal}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="p-3 text-center font-black text-slate-700">{item.submit}</td>
                            <td className="p-3 text-center text-slate-500">{item.draft}</td>
                            <td className="p-3 text-center font-black text-slate-700">{item.total}</td>
                          </>
                        )}

                        <td className="p-3 text-center pr-4 whitespace-nowrap font-sans">
                          {item.isFirstDay ? (
                            <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded text-[9px] uppercase">Awal Siklus</span>
                          ) : (
                            <span className="bg-green-50 text-green-700 font-extrabold px-2 py-0.5 rounded text-[9px] uppercase">Unggah Aktif</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="text-center p-8 text-slate-400 font-sans">
                      Tidak ada catatan log progres yang cocok dengan filter penelusuran.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {processedRecords.length > 0 && (
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-500 font-semibold">
              <div className="text-slate-500">
                Menampilkan <span className="text-slate-800 font-bold">{(dailyLogPage - 1) * 10 + 1}</span> - <span className="text-slate-800 font-bold">{Math.min(dailyLogPage * 10, processedRecords.length)}</span> dari <span className="text-slate-800 font-bold">{processedRecords.length}</span> log aktivitas
              </div>
              <div className="flex gap-1.5 shrink-0 animate-fade-in">
                <button
                  disabled={dailyLogPage === 1}
                  onClick={() => setDailyLogPage(prev => Math.max(1, prev - 1))}
                  className="px-2.5 py-1 bg-white border border-slate-250 rounded hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-755 font-bold transition-all disabled:cursor-not-allowed cursor-pointer"
                >
                  Sebelumnya
                </button>
                <div className="flex items-center px-1 text-slate-700 font-sans font-bold text-[11px]">
                  Halaman {dailyLogPage} / {totalDailyLogPages}
                </div>
                <button
                  disabled={dailyLogPage === totalDailyLogPages}
                  onClick={() => setDailyLogPage(prev => Math.min(totalDailyLogPages, prev + 1))}
                  className="px-2.5 py-1 bg-white border border-slate-250 rounded hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white text-slate-755 font-bold transition-all disabled:cursor-not-allowed cursor-pointer"
                >
                  Selanjutnya
                </button>
              </div>
            </div>
          )}
        </div>

      </main>

      {/* Footer Bar consistent with the design specification */}
      <footer className="bg-slate-800 text-slate-400 px-4 py-3 flex flex-col sm:flex-row justify-between items-center text-[10px] shrink-0 gap-2 mt-8 border-t border-slate-900">
        <div className="flex flex-wrap gap-4 justify-center sm:justify-start">
          <span>ID Spreadsheet: <b className="font-mono">{SPREADSHEET_ID}</b></span>
          <span>•</span>
          <span>Sheet Aktif: <b className="text-slate-200">rekap & data lama</b></span>
          <span>•</span>
          <span>Repository: <a href="https://github.com/ahmadrahman79/Monitoring-SE2026" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline hover:text-blue-300">ahmadrahman79/Monitoring-SE2026</a></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse"></span>
          <span>Otomasi Sync: <b className="text-green-400 font-bold text-[9px] uppercase tracking-wider">AKTIF (30m)</b></span>
        </div>
      </footer>

    </div>
  );
}
