/** Aggregates only: never add transcript text or row identifiers to this DTO. */
export type ReportRange = 'week' | 'month' | 'all';
export interface ReportInput { range: ReportRange }
export interface ReportTotals {
  dictations: number;
  commands: number;
  characters: number;
  speakingMs: number;
  charactersPerMinute: number | null;
  typingMs: number;
  savedMs: number;
}
export interface FillerCount { term: string; spoken: number; removed: number }
export interface WordCount { word: string; count: number }
export interface SpeechReport extends ReportTotals {
  range: ReportRange;
  previous: Pick<ReportTotals, 'dictations' | 'characters' | 'savedMs'> | null;
  fillers: { top: FillerCount[]; total: number; removedTotal: number };
  corrections: number;
  hours: number[];
  peakHour: number | null;
  weekdays: number[];
  words: WordCount[];
  headline: string;
}
export type ReportComment = { text: string } | { error: string };
