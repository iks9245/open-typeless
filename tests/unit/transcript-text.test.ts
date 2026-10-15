import { describe, expect, it } from 'vitest';
import { joinSegments } from '../../src/main/services/asr/lib/transcript-text';

describe('joinSegments', () => {
  it('trims leading and trailing whitespace', () => {
    expect(joinSegments(' \t\r\n  語音輸入 \t\r\n')).toBe('語音輸入');
    expect(joinSegments(' \t\r\n')).toBe('');
    expect(joinSegments('')).toBe('');
  });

  it.each([
    { text: '語\n音', expected: '語音' },
    { text: 'か\nな', expected: 'かな' },
    { text: 'カ\nナ', expected: 'カナ' },
    { text: '한\n글', expected: '한글' },
    { text: '語\n。', expected: '語。' },
    { text: '。\n語', expected: '。語' },
    { text: '語\n、', expected: '語、' },
    { text: '、\n語', expected: '、語' },
  ])('removes a break between CJK characters in $text', ({ text, expected }) => {
    expect(joinSegments(text)).toBe(expected);
  });

  it.each([
    { text: 'can\n do', expected: 'can do' },
    { text: '用\nJeris', expected: '用 Jeris' },
    { text: 'Jeris\n用', expected: 'Jeris 用' },
    { text: '1\n2', expected: '1 2' },
    { text: '用\n2', expected: '用 2' },
    { text: '2\n用', expected: '2 用' },
  ])('replaces a break next to Latin text or digits in $text with a space', ({ text, expected }) => {
    expect(joinSegments(text)).toBe(expected);
  });

  it.each([
    { text: '語 \t\r\n \t音', expected: '語音' },
    { text: 'can \t\r\n \tdo', expected: 'can do' },
    { text: '用 \t\r\n \tJeris', expected: '用 Jeris' },
  ])('handles CRLF and surrounding spaces and tabs in $text', ({ text, expected }) => {
    expect(joinSegments(text)).toBe(expected);
  });

  it.each([
    { text: 'can\n\n\n do', expected: 'can do' },
    { text: 'can \t\r\n \t\r\n\ndo', expected: 'can do' },
    { text: '語\n\n\n音', expected: '語音' },
    { text: '用\r\n\n \tJeris', expected: '用 Jeris' },
  ])('joins consecutive breaks in $text without double spaces', ({ text, expected }) => {
    expect(joinSegments(text)).toBe(expected);
  });

  it('removes each break in a sequence of CJK characters', () => {
    expect(joinSegments('一\n二\n三\n四')).toBe('一二三四');
  });

  it.each(['語音輸入。', 'can do', '用 Jeris 2', '語音\t輸入'])('preserves text without breaks: %j', (text) => {
    expect(joinSegments(text)).toBe(text);
  });

  it('preserves repeated internal spaces in text without breaks', () => {
    expect(joinSegments('can  do   this')).toBe('can  do   this');
  });
});
