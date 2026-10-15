import { describe, expect, it } from 'vitest';
import { acceptPolished } from '../../src/main/services/polish/lib/sanitize';

describe('polish output checks', () => {
  it.each([
    ['你好', ' <think>reason\nreason</think><transcript>你好。</transcript> ', '你好。'],
    ['你好', '<THINK>one</THINK><think>two</think>你好。', '你好。'],
    ['你好', '“你好。”', '你好。'],
    ['你好', '「你好。」', '你好。'],
    ['你好', '"你好。"', '你好。'],
    ['「你好」', '「你好。」', '「你好。」'],
    ['“你好”', '“你好。”', '“你好。”'],
    ['"你好"', '"你好。"', '"你好。"'],
    ['我哋唔去', '我哋唔去。', '我哋唔去。'],
  ])('cleans %j → %j', (raw, output, text) => {
    expect(acceptPolished(raw, output)).toEqual({ ok: true, text });
  });

  it.each(['', '  ', '<think>unfinished reasoning', ' \n<THINK>unfinished', '<think>reason</think>', '<transcript><think>unfinished', '""'])('rejects empty output %j', (output) => {
    expect(acceptPolished('你好', output)).toEqual({ ok: false, reason: 'empty' });
  });

  it('enforces both length limits with code points, including their boundaries', () => {
    expect(acceptPolished('😀'.repeat(20), '😀'.repeat(50)).ok).toBe(true);
    expect(acceptPolished('😀'.repeat(20), '😀'.repeat(51))).toEqual({ ok: false, reason: 'too long' });
    expect(acceptPolished('😀'.repeat(20), '😀'.repeat(6)).ok).toBe(true);
    expect(acceptPolished('😀'.repeat(20), '😀'.repeat(5))).toEqual({ ok: false, reason: 'too short' });
    expect(acceptPolished('a'.repeat(19), 'a').ok).toBe(true);
  });
});
