import { MAX_VOCABULARY_TERMS, MAX_VOCABULARY_TERM_LENGTH } from '../../../../../shared/lib/vocabulary-prompt';

/** Match the shared prompt's trimming, case folding and UTF-16 length rules. */
export function validateVocabularyTerm(raw: string, terms: readonly string[]): string | null {
  const term = raw.trim();
  if (!term) return '詞彙不可空白。';
  if (term.length > MAX_VOCABULARY_TERM_LENGTH) return `詞彙不可超過 ${MAX_VOCABULARY_TERM_LENGTH} 字。`;
  if (terms.some((existing) => existing.trim().toLocaleLowerCase() === term.toLocaleLowerCase())) {
    return '這個詞彙已經存在，請勿重複新增。';
  }
  if (terms.length >= MAX_VOCABULARY_TERMS) return `詞彙已達 ${MAX_VOCABULARY_TERMS} 個上限。`;
  return null;
}
