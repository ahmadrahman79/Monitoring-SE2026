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

// Formats a JS Date object into an Indonesian date string (e.g., "19 Juni 2026")
export function formatIndonesianDate(date: Date): string {
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
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
  
  // --- First pass: Detect duplicate PPL names across different PMLs ---
  const pplNameToPmls = new Map<string, Set<string>>();
  
  const registerPplPml = (ppl: string, pml: string) => {
    if (!ppl || !pml) return;
    if (!pplNameToPmls.has(ppl)) {
      pplNameToPmls.set(ppl, new Set());
    }
    pplNameToPmls.get(ppl)!.add(pml);
  };

  // Find occurrences in rekap
  const rekapLinesForScan = rekapCSV.split(/\r?\n/);
  for (let i = 1; i < rekapLinesForScan.length; i++) {
    const line = rekapLinesForScan[i].trim();
    if (!line) continue;
    const rawCols = parseCSVLine(line);
    const cols = rawCols.map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length >= 2 && cols[0] && cols[0] !== 'Nama PML' && cols[1]) {
      let pmlName = cols[0] === '#N/A' ? 'Belum Terpetakan' : cols[0];
      let pplName = cols[1] === '#N/A' ? 'Belum Terpetakan' : cols[1];
      registerPplPml(pplName, pmlName);
    }
  }

  // Analyze headers for data lama
  let dataLamaPmlIdx = 0;
  let dataLamaPplIdx = 1;
  let dataLamaSubmitIdx = 2;
  let dataLamaDraftIdx = 3;
  let dataLamaTotalIdx = 4;
  let dataLamaDateIdx = 5;

  const dataLamaLinesForScan = dataLamaCSV.split(/\r?\n/);
  if (dataLamaLinesForScan.length > 0) {
    const headerCols = parseCSVLine(dataLamaLinesForScan[0]).map(c => c.replace(/^"|"$/g, '').trim());
    if (headerCols[0] === 'PrimaryKey2') {
      dataLamaPplIdx = 2;
      dataLamaPmlIdx = 3;
      dataLamaSubmitIdx = 5;
      dataLamaDraftIdx = 6;
      dataLamaTotalIdx = 7;
      dataLamaDateIdx = -1; // Use yesterday's date or similar fallback
    } else if (headerCols[0] === 'Nama PML' && headerCols.length >= 7) { // Like rekap harian
      dataLamaPmlIdx = 0;
      dataLamaPplIdx = 1;
      dataLamaSubmitIdx = 2;
      dataLamaDraftIdx = 3;
      dataLamaTotalIdx = 4;
      dataLamaDateIdx = 6;
    }
  }

  // Find occurrences in data lama
  for (let i = 1; i < dataLamaLinesForScan.length; i++) {
    const line = dataLamaLinesForScan[i].trim();
    if (!line) continue;
    const rawCols = parseCSVLine(line);
    const cols = rawCols.map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length > Math.max(dataLamaPmlIdx, dataLamaPplIdx) && cols[dataLamaPmlIdx] && cols[dataLamaPmlIdx] !== 'Nama PML' && cols[dataLamaPplIdx] && cols[dataLamaPplIdx] !== 'Nama PPL') {
      let pmlName = cols[dataLamaPmlIdx] === '#N/A' ? 'Belum Terpetakan' : cols[dataLamaPmlIdx];
      let pplName = cols[dataLamaPplIdx] === '#N/A' ? 'Belum Terpetakan' : cols[dataLamaPplIdx];
      registerPplPml(pplName, pmlName);
    }
  }

  // Determine duplicate names
  const duplicatePpls = new Set<string>();
  pplNameToPmls.forEach((pmls, ppl) => {
    if (pmls.size > 1) {
      duplicatePpls.add(ppl);
    }
  });

  // Disambiguation helper
  const getDisambiguatedPplName = (ppl: string, pml: string): string => {
    if (duplicatePpls.has(ppl)) {
      return `${ppl} (${pml})`;
    }
    return ppl;
  };

  // 2. Parse rekap (holds active day's entries)
  const rekapLines = rekapCSV.split(/\r?\n/);
  for (let i = 1; i < rekapLines.length; i++) {
    const line = rekapLines[i].trim();
    if (!line) continue;
    
    const rawCols = parseCSVLine(line);
    const cols = rawCols.map(c => c.replace(/^"|"$/g, '').trim());
    
    // Ensure matching column indices:
    // Kolom A (index 0): Nama PML
    // Kolom B (index 1): Nama PPL
    // Kolom C (index 2): Submit
    // Kolom D (index 3): Draf
    // Kolom E (index 4): Total
    // Kolom F (index 5): Target
    if (cols.length >= 5 && cols[0] && cols[0] !== 'Nama PML' && cols[1]) {
      let pmlName = cols[0]; // Kolom A
      let pplName = cols[1]; // Kolom B
      if (pmlName === '#N/A') pmlName = 'Belum Terpetakan';
      if (pplName === '#N/A') pplName = 'Belum Terpetakan';
      
      const submit = parseInt(cols[2], 10) || 0; // Kolom C
      const draft = parseInt(cols[3], 10) || 0;  // Kolom D
      const total = parseInt(cols[4], 10) || 0;  // Kolom E
      const mempawahTargetValue = cols[5] ? (parseInt(cols[5], 10) || 0) : 0; // Kolom F
      const mempawahTarget = mempawahTargetValue > 0 ? mempawahTargetValue : total;
      
      const disambiguatedName = getDisambiguatedPplName(pplName, pmlName);
      
      table1.push({ pmlName, pplName: disambiguatedName, submit, draft, total, mempawahTarget });
      
      // Add active dynamic snapshot to chronological log
      table3.push({
        pmlName,
        pplName: disambiguatedName,
        submit,
        draft,
        total,
        mempawahTarget,
        dateStr: activeWIBDateStr,
        date: parseIndonesianDate(activeWIBDateStr),
        isLiveRekap: true
      });
    }
  }
  
  // Create a map of PPL -> mempawahTarget from rekap for historical lookup
  const pplTargetMap = new Map<string, number>();
  table1.forEach(item => {
    pplTargetMap.set(item.pplName, item.mempawahTarget || item.total);
  });
  
  // 3. Parse historical data from data lama CSV
  const dataLamaLines = dataLamaCSV.split(/\r?\n/);
  for (let i = 1; i < dataLamaLines.length; i++) {
    const line = dataLamaLines[i].trim();
    if (!line) continue;
    
    const rawCols = parseCSVLine(line);
    const cols = rawCols.map(c => c.replace(/^"|"$/g, '').trim());
    
    if (cols.length > Math.max(dataLamaPmlIdx, dataLamaPplIdx) && cols[dataLamaPmlIdx] && cols[dataLamaPmlIdx] !== 'Nama PML' && cols[dataLamaPplIdx] && cols[dataLamaPplIdx] !== 'Nama PPL') {
      let pmlName = cols[dataLamaPmlIdx];
      let pplName = cols[dataLamaPplIdx];
      if (pmlName === '#N/A') pmlName = 'Belum Terpetakan';
      if (pplName === '#N/A') pplName = 'Belum Terpetakan';
      
      const submit = parseInt(cols[dataLamaSubmitIdx], 10) || 0;
      const draft = parseInt(cols[dataLamaDraftIdx], 10) || 0;
      const total = parseInt(cols[dataLamaTotalIdx], 10) || 0;
      
      let dateStr = '';
      if (dataLamaDateIdx >= 0 && cols[dataLamaDateIdx]) {
        dateStr = cols[dataLamaDateIdx];
      } else {
        // Fallback to yesterday if no date column exists in data lama
        const activeDateObj = parseIndonesianDate(activeWIBDateStr);
        activeDateObj.setDate(activeDateObj.getDate() - 1);
        dateStr = formatIndonesianDate(activeDateObj);
      }
      
      const disambiguatedName = getDisambiguatedPplName(pplName, pmlName);
      
      // De-duplicate: If rekap is already assigned to this dateStr (e.g. today has already been pushed to data lama),
      // let the active "rekap" row take precedence and don't duplicate.
      const isDuplicate = table3.some(item => item.pplName === disambiguatedName && item.dateStr === dateStr);
      if (!isDuplicate) {
        const mempawahTarget = pplTargetMap.get(disambiguatedName) || total;
        table3.push({
          pmlName,
          pplName: disambiguatedName,
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
  
  // Find minimum and maximum dates in the dataset
  let minTime = Number.MAX_SAFE_INTEGER;
  let maxTime = 0;
  for (const rec of table3) {
    if (rec.date.getTime() < minTime) {
      minTime = rec.date.getTime();
    }
    if (rec.date.getTime() > maxTime) {
      maxTime = rec.date.getTime();
    }
  }
  
  // Create an array of continuous date strings starting from minTime
  const allDatesList: { date: Date, dateStr: string }[] = [];
  let currTime = minTime;
  while (currTime <= maxTime) {
    const d = new Date(currTime);
    allDatesList.push({
      date: d,
      dateStr: formatIndonesianDate(d)
    });
    currTime += 24 * 60 * 60 * 1000;
  }
  
  for (const pplName in pplRecords) {
    const records = pplRecords[pplName];
    // Sort chronological progress
    records.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    let lastCumulativeRecord: Table3Record | null = null;
    let prevDailyCumulative: { submit: number, draft: number, total: number } = { submit: 0, draft: 0, total: 0 };
    
    for (let i = 0; i < allDatesList.length; i++) {
      const targetDateObj = allDatesList[i];
      const targetTime = targetDateObj.date.getTime();
      
      // Find the latest record that is ON or BEFORE the targetDate
      let currentCumulativeRecord = lastCumulativeRecord;
      for (const rec of records) {
        if (rec.date.getTime() <= targetTime) {
          currentCumulativeRecord = rec;
        } else {
          break; // Since it's sorted, we can stop
        }
      }
      
      let submit = 0, draft = 0, total = 0, mempawahTarget = 0, pmlName = "";
      let isLiveRekap = false;
      if (currentCumulativeRecord) {
        submit = currentCumulativeRecord.submit;
        draft = currentCumulativeRecord.draft;
        total = currentCumulativeRecord.total;
        mempawahTarget = currentCumulativeRecord.mempawahTarget || 0;
        pmlName = currentCumulativeRecord.pmlName;
        // Only mark as live rekap if the date matches exactly
        if (currentCumulativeRecord.dateStr === targetDateObj.dateStr) {
          isLiveRekap = !!currentCumulativeRecord.isLiveRekap;
        }
      } else if (records.length > 0) {
        // If we haven't reached the first record yet, use the first record's static data but 0 progress
        mempawahTarget = records[0].mempawahTarget;
        pmlName = records[0].pmlName;
      }
      
      let dailySubmit = 0;
      let dailyDraft = 0;
      let dailyTotal = 0;
      let isFirstDay = false;
      
      if (i === 0) {
        // For the very first historical date, we just take the raw value as baseline
        // Delta is 0 because we cannot know how much was done specifically on this day
        dailySubmit = 0;
        dailyDraft = 0;
        dailyTotal = 0;
        isFirstDay = true;
      } else {
        // For subsequent days, subtract the previous day's cumulative progress
        dailySubmit = Math.max(0, submit - prevDailyCumulative.submit);
        dailyDraft = Math.max(0, draft - prevDailyCumulative.draft);
        dailyTotal = Math.max(0, total - prevDailyCumulative.total);
        isFirstDay = false;
      }
      
      if (pmlName) {
        table3Calculated.push({
          pplName,
          pmlName,
          mempawahTarget,
          dateStr: targetDateObj.dateStr,
          date: targetDateObj.date,
          submit,
          draft,
          total,
          dailySubmit,
          dailyDraft,
          dailyTotal,
          isFirstDay,
          isLiveRekap
        });
      }
      
      // Update for the next iteration
      prevDailyCumulative = { submit, draft, total };
      lastCumulativeRecord = currentCumulativeRecord;
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

