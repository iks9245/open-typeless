import type { FillerCount, SpeechReport } from '../../../../shared/types/report';
import type { ReportRow } from '../types';

export const FILLER_TERMS = [
  '嗯', '呃', '啊', '欸', '那個', '就是', '然後', '其實', '基本上',
  '即係', '嗰個', '呢個', '咁樣', 'um', 'uh', 'like', 'you know', 'basically', 'actually',
] as const;
const interjections = new Set(['嗯', '呃', '啊', '欸']);
const cjk = /\p{Script=Han}/u;

export function countTerm(text: string, term: string): number {
  if (/^[a-z ]+$/i.test(term)) return [...text.matchAll(new RegExp(`\\b${term}\\b`, 'gi'))].length;
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(term, offset);
    if (index < 0) break;
    // A leading interjection is counted even in 「嗯那個」. Inside text it must stand alone.
    const before = Array.from(text.slice(Math.max(0, index - 2), index)).at(-1) ?? '';
    const after = Array.from(text.slice(index + term.length, index + term.length + 2))[0] ?? '';
    if (!interjections.has(term) || index === 0 || (!cjk.test(before) && !cjk.test(after))) count++;
    offset = index + term.length;
  }
  return count;
}

export function summarizeFillers(rows: readonly ReportRow[]): SpeechReport['fillers'] {
  const counts: FillerCount[] = FILLER_TERMS.map(term => ({ term, spoken: 0, removed: 0 }));
  for (const row of rows) {
    if (row.mode !== 'dictation') continue;
    for (const item of counts) {
      const spoken = countTerm(row.rawText ?? '', item.term);
      item.spoken += spoken;
      if (row.rawText !== row.finalText) item.removed += Math.max(0, spoken - countTerm(row.finalText ?? '', item.term));
    }
  }
  return {
    top: counts.filter(item => item.spoken > 0).sort((a, b) => b.spoken - a.spoken).slice(0, 8),
    total: counts.reduce((sum, item) => sum + item.spoken, 0),
    removedTotal: counts.reduce((sum, item) => sum + item.removed, 0),
  };
}

export function countCorrections(rows: readonly ReportRow[]): number {
  return rows.filter(row => row.mode === 'dictation').reduce((sum, row) => sum
    + ['不對', '我是說', '應該是', '講錯', '唔係', '我意思係']
      .reduce((total, term) => total + countTerm(row.rawText ?? '', term), 0), 0);
}
