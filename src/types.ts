export interface PPLSummary {
  pmlName: string;
  pplName: string;
  submit: number;
  draft: number;
  total: number;
  mempawahTarget?: number;
}

export interface Table3Record {
  pmlName: string;
  pplName: string;
  submit: number;
  draft: number;
  total: number;
  dateStr: string;   // e.g., "19 Juni 2026"
  date: Date;        // parsed JavaScript Date object
  mempawahTarget?: number;
  isLiveRekap?: boolean; // Flag to indicate this came from live rekap vs saved/firebase
}

export interface PPLDailyProgress extends Table3Record {
  dailySubmit: number; // submit - previous_submit
  dailyDraft: number;   // draft - previous_draft
  dailyTotal: number;   // total - previous_total
  isFirstDay: boolean;  // whether this is the first date entry for this PPL
}
