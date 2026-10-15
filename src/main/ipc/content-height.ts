/** Validate renderer input before it reaches native window sizing. */
export function validateContentHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(2000, Math.max(0, value));
}
