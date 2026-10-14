import { describe, expect, it } from 'vitest';
import { buildVocabularyPrompt } from '../../src/main/services/asr/lib/vocabulary-prompt';

describe('buildVocabularyPrompt', () => {
  it('returns null for an empty list', () => {
    expect(buildVocabularyPrompt([])).toBeNull();
  });

  it('returns null when all terms are empty or whitespace', () => {
    expect(buildVocabularyPrompt(['', ' ', '\t\r\n', '　'])).toBeNull();
  });

  it.each([
    { terms: ['A'], expected: '這段話可能會提到 A。' },
    { terms: ['A', 'B'], expected: '這段話可能會提到 A 和 B。' },
    { terms: ['A', 'B', 'C'], expected: '這段話可能會提到 A、B 和 C。' },
  ])('formats $terms as a Traditional Chinese sentence', ({ terms, expected }) => {
    expect(buildVocabularyPrompt(terms)).toBe(expected);
  });

  it('trims terms and skips empty terms', () => {
    expect(buildVocabularyPrompt([' \tA\n', '', '  ', ' B ', '\tC\t']))
      .toBe('這段話可能會提到 A、B 和 C。');
  });

  it('removes duplicates case-insensitively while preserving first spelling and order', () => {
    expect(buildVocabularyPrompt([' Jeris ', 'Open Typeless', 'JERIS', 'open typeless', 'CJK', 'jeris']))
      .toBe('這段話可能會提到 Jeris、Open Typeless 和 CJK。');
  });

  it('keeps CJK and mixed terms verbatim', () => {
    expect(buildVocabularyPrompt(['自訂詞彙', 'ジェリス', '한글', 'Open Typeless 語音2.0']))
      .toBe('這段話可能會提到 自訂詞彙、ジェリス、한글 和 Open Typeless 語音2.0。');
  });

  it('accepts a single term exactly 150 characters long', () => {
    const term = 'A'.repeat(150);
    expect(buildVocabularyPrompt([term])).toBe(`這段話可能會提到 ${term}。`);
  });

  it('caps the sum of trimmed term lengths without counting separators or duplicates', () => {
    const first = 'A'.repeat(100);
    const second = 'B'.repeat(50);
    expect(buildVocabularyPrompt([` ${first} `, first.toLowerCase(), `\t${second}\t`, 'C']))
      .toBe(`這段話可能會提到 ${first} 和 ${second}。`);
  });

  it('drops a term that exceeds the cap while keeping earlier terms', () => {
    const first = 'A'.repeat(100);
    expect(buildVocabularyPrompt([first, 'B'.repeat(51)]))
      .toBe(`這段話可能會提到 ${first}。`);
  });

  it('keeps later terms that fit after dropping a term that exceeds the cap', () => {
    const first = 'A'.repeat(100);
    expect(buildVocabularyPrompt([first, 'B'.repeat(51), 'C']))
      .toBe(`這段話可能會提到 ${first} 和 C。`);
  });

  it('returns null for a single term longer than 150 characters', () => {
    expect(buildVocabularyPrompt(['A'.repeat(151)])).toBeNull();
  });
});
