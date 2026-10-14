import { describe, expect, it } from 'vitest';
import { MAX_VOCABULARY_TERMS, MAX_VOCABULARY_TERM_LENGTH, planVocabularyPrompt } from '../../src/shared/lib/vocabulary-prompt';
import { validateVocabularyTerm } from '../../src/renderer/src/modules/main-window/lib/vocabulary';

describe('vocabulary validation', () => {
  it.each(['', ' ', '\t\n', '　'])('rejects blank input %j', (term) => {
    expect(validateVocabularyTerm(term, [])).toBe('詞彙不可空白。');
  });

  it('trims before validating and accepts mixed language terms', () => {
    expect(validateVocabularyTerm('　Open Typeless 語音2.0\t', [])).toBeNull();
    expect(validateVocabularyTerm(` ${'字'.repeat(MAX_VOCABULARY_TERM_LENGTH)} `, [])).toBeNull();
  });

  it('enforces the shared length boundary in UTF-16 code units', () => {
    expect(validateVocabularyTerm('字'.repeat(MAX_VOCABULARY_TERM_LENGTH + 1), [])).toBe('詞彙不可超過 40 字。');
    expect(validateVocabularyTerm('😀'.repeat(20), [])).toBeNull();
    expect(validateVocabularyTerm('😀'.repeat(21), [])).toBe('詞彙不可超過 40 字。');
  });

  it('rejects duplicates ignoring whitespace and case without rejecting different terms', () => {
    expect(validateVocabularyTerm(' open TYPELESS ', ['Open Typeless'])).toBe('這個詞彙已經存在，請勿重複新增。');
    expect(validateVocabularyTerm('Jeris', [' jeris '])).toBe('這個詞彙已經存在，請勿重複新增。');
    expect(validateVocabularyTerm('Jeris', ['Jeris 工具'])).toBeNull();
  });

  it('allows the last slot, then rejects a 51st term', () => {
    const full = Array.from({ length: MAX_VOCABULARY_TERMS }, (_, index) => `詞彙${index}`);
    expect(validateVocabularyTerm('新詞彙', full.slice(0, -1))).toBeNull();
    expect(validateVocabularyTerm('新詞彙', full)).toBe('詞彙已達 50 個上限。');
  });

  it('gives specific input errors before the count limit error', () => {
    const full = Array.from({ length: MAX_VOCABULARY_TERMS }, (_, index) => `詞彙${index}`);
    expect(validateVocabularyTerm('詞彙0', full)).toBe('這個詞彙已經存在，請勿重複新增。');
    expect(validateVocabularyTerm(' ', full)).toBe('詞彙不可空白。');
  });

  it('allows terms that the shared prompt planner may skip without discarding later short terms', () => {
    const terms = ['甲'.repeat(40), '乙'.repeat(40), '丙'.repeat(40), '丁'.repeat(40), '短詞'];
    for (const term of terms) expect(validateVocabularyTerm(term, [])).toBeNull();
    const plan = planVocabularyPrompt(terms);
    expect(plan.skipped).toEqual([terms[3]]);
    expect(plan.included).toEqual([terms[0], terms[1], terms[2], terms[4]]);
    expect(plan.prompt).toBe(`這段話可能會提到 ${terms[0]}、${terms[1]}、${terms[2]} 和 短詞。`);
  });
});
