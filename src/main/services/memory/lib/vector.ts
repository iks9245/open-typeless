/** Explicit little-endian storage works regardless of host alignment/endianness. */
export function encodeVector(vector: readonly number[]): Buffer {
  const blob = Buffer.alloc(vector.length * 4);
  vector.forEach((value, i) => blob.writeFloatLE(value, i * 4));
  return blob;
}
export function decodeVector(blob: Buffer): number[] {
  if (!blob.length || blob.length % 4 !== 0) throw new Error('Invalid vector');
  return Array.from({ length: blob.length / 4 }, (_, i) => blob.readFloatLE(i * 4));
}
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  const score = dot / Math.sqrt(aa * bb);
  return Number.isFinite(score) ? score : 0;
}
