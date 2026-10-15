import { describe, expect, it } from 'vitest';
import { validateContentHeight } from '../../src/main/ipc/content-height';

describe('floating content height', () => {
  it.each([NaN, Infinity, -Infinity, '18', null, undefined, {}, [], true].map((value) => ({ value })))('rejects invalid input $value', ({ value }) => {
    expect(validateContentHeight(value)).toBeNull();
  });

  it.each([
    [-100, 0], [0, 0], [18, 18], [72.5, 72.5], [2000, 2000], [9000, 2000],
  ])('clamps %s to %s', (input, expected) => {
    expect(validateContentHeight(input)).toBe(expected);
  });
});
