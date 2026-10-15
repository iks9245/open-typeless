import { describe, expect, it } from 'vitest';
import { TRIGGER_KEYS, triggerKeyLabel } from '../../src/shared/constants/keyboard';

describe('trigger key labels', () => {
  it.each(TRIGGER_KEYS)('labels $id as $label', ({ id, label }) => {
    expect(triggerKeyLabel(id)).toBe(label);
  });
  it.each([undefined, null, '', 'unknown'])('falls back to Right Option for %s', id => {
    expect(triggerKeyLabel(id)).toBe('右 Option');
  });
});
