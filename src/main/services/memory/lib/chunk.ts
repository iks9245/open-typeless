import { createHash } from 'node:crypto';

export function chunkText(text: string): string[] {
  const points = Array.from(text);
  if (points.length === 0) return [];
  if (points.length <= 600) return [text];
  const chunks: string[] = [];
  for (let start = 0; start < points.length; start += 400) {
    chunks.push(points.slice(start, start + 500).join(''));
    if (start + 500 >= points.length) break;
  }
  return chunks;
}
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
