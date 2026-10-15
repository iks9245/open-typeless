import type { ReportRange, ReportTotals, SpeechReport } from '../../../../shared/types/report';
import type { ReportRow } from '../types';
import { countCorrections, summarizeFillers } from './fillers';
import { topWords } from './words';
import { reportHeadline } from './headline';

export function reportWindow(range: ReportRange, now: number): { start: number | null; previousStart: number | null; end: number } {
  const span = range === 'all' ? null : (range === 'week' ? 7 : 30) * 86400000;
  return { start: span === null ? null : now - span, previousStart: span === null ? null : now - span * 2, end: now };
}

export function totals(rows: readonly ReportRow[]): ReportTotals {
  let dictations = 0, commands = 0, characters = 0, speakingMs = 0, latencyMs = 0;
  for (const row of rows) {
    if (row.mode === 'dictation') dictations++;
    else commands++;
    characters += Array.from((row.finalText ?? '').replace(/\s/gu, '')).length;
    speakingMs += row.audioDurationMs ?? 0;
    latencyMs += row.latencyMs ?? 0;
  }
  const typingMs = characters / 40 * 60000;
  return { dictations, commands, characters, speakingMs, typingMs,
    charactersPerMinute: speakingMs === 0 ? null : characters / (speakingMs / 60000),
    savedMs: Math.max(0, typingMs - speakingMs - latencyMs) };
}

/** Input contains completed rows only; the service enforces status in SQL. */
export function buildReport(rows: readonly ReportRow[], range: ReportRange, now: number): SpeechReport {
  const window = reportWindow(range, now);
  const current = rows.filter(row => row.createdAt < now && (window.start === null || row.createdAt >= window.start));
  const prior = window.start === null ? null : totals(rows.filter(row =>
    window.previousStart !== null && row.createdAt >= window.previousStart && row.createdAt < (window.start ?? now)));
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  for (const row of current) {
    const date = new Date(row.createdAt);
    if (row.mode === 'dictation') hours[date.getHours()]++;
    weekdays[(date.getDay() + 6) % 7]++;
  }
  const report: Omit<SpeechReport, 'headline'> = {
    range, ...totals(current), previous: prior === null ? null
      : { dictations: prior.dictations, characters: prior.characters, savedMs: prior.savedMs },
    fillers: summarizeFillers(current), corrections: countCorrections(current), hours, weekdays,
    peakHour: hours.some(Boolean) ? hours.indexOf(Math.max(...hours)) : null, words: topWords(current),
  };
  return { ...report, headline: reportHeadline(report) };
}
