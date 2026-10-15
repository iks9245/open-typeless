import { cosine } from './vector';
import type { TimeRange } from './time-range';

/**
 * Calibrated on Qwen3-Embedding-0.6B (2026-10-15): matching dictations scored 0.57–0.80,
 * questions with no answer in the records peaked at 0.46–0.50, and 95% of unrelated pairs
 * scored below 0.49.
 */
export const MIN_SCORE = 0.5;
/** Chunks far below the best match are noise for the answer model */
export const RELATIVE_WINDOW = 0.15;

export interface MemoryChunk {
  transcriptionId: string;
  chunkIndex: number;
  createdAt: number;
  text: string;
  vector: number[];
}
const stopwords = new Set(['什麼', '多少', '怎麼', '如何', '哪些', '我的', '我們', '你們', '這個', '那個',
  '今天', '昨天', '前天', '這週', '本週', '上週', '禮拜', '最近', 'the', 'what', 'when', 'where', 'how', 'was', 'are', 'and', 'for', 'that', 'this', 'with']);
export function questionWords(question: string): string[] {
  return [...new Set(Array.from(new Intl.Segmenter('zh-TW', { granularity: 'word' }).segment(question.toLowerCase()))
    .filter(part => part.isWordLike).map(part => part.segment)
    .filter(word => !stopwords.has(word) && (/^\p{Script=Han}{2,}$/u.test(word) || /^\p{Script=Latin}{3,}$/u.test(word))))];
}
export function keywordBoost(question: string, text: string): number {
  const lower = text.toLowerCase();
  return Math.min(0.15, questionWords(question).filter(word => lower.includes(word)).length * 0.05);
}
export function rankChunks(question: string, vector: number[], chunks: MemoryChunk[], time: TimeRange | null = null): MemoryChunk[] {
  const best = new Map<string, MemoryChunk & { score: number }>();
  for (const chunk of chunks) {
    if (time && (chunk.createdAt < time.start || chunk.createdAt >= time.end)) continue;
    const score = cosine(vector, chunk.vector) + keywordBoost(question, chunk.text);
    if (score < MIN_SCORE) continue;
    if (score > (best.get(chunk.transcriptionId)?.score ?? -Infinity)) best.set(chunk.transcriptionId, { ...chunk, score });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt ||
    a.transcriptionId.localeCompare(b.transcriptionId));
  const top = ranked[0]?.score ?? 0;
  return ranked.filter(chunk => chunk.score >= top - RELATIVE_WINDOW).slice(0, 8);
}
