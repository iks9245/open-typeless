import type { WordCount } from '../../../../shared/types/report';
import type { ReportRow } from '../types';
import { FILLER_TERMS } from './fillers';

export const STOPWORDS = new Set<string>([
  ...FILLER_TERMS, '我們', '你們', '他們', '自己', '這個', '這些', '那個', '那些', '一個',
  '可以', '沒有', '不是', '因為', '所以', '但是', '如果', '現在', '已經', '還是',
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'was', 'have', 'has',
  'not', 'but', 'from', 'they', 'our', 'will', 'would', 'can', 'could', 'about', 'your',
]);
const segmenter = new Intl.Segmenter('zh-Hant', { granularity: 'word' });

export function topWords(rows: readonly ReportRow[]): WordCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.mode !== 'dictation') continue;
    // A multiword filler would otherwise leave fragments such as 「know」 in the ranking.
    const text = (row.finalText ?? '').replace(/\byou know\b/gi, ' ');
    for (const segment of segmenter.segment(text)) {
      const word = segment.segment.toLowerCase();
      if (!segment.isWordLike || STOPWORDS.has(word)) continue;
      if (!/^(?:\p{Script=Han}{2,}|\p{Script=Latin}{3,})$/u.test(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts].map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, 'zh-Hant')).slice(0, 10);
}
