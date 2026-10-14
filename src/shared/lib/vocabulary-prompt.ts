/**
 * Builds the whisper.cpp prompt that biases recognition toward the user's vocabulary.
 * Shared so the settings UI previews exactly what the main process sends.
 *
 * Measured with synthesized Taiwanese Mandarin against large-v3-turbo (2026-10-15):
 * - no prompt: proper nouns misheard (e.g. "OpenT Plus", "Jenrys") and output in
 *   Simplified Chinese
 * - a comma-separated term list: little improvement, still Simplified
 * - a natural Traditional Chinese sentence naming the terms: "Open Typeless" recognized
 *   and output in Traditional Chinese, without inserting terms into unrelated sentences
 */

/** Most terms a vocabulary may hold */
export const MAX_VOCABULARY_TERMS = 50;

/** Longest single term, in UTF-16 code units */
export const MAX_VOCABULARY_TERM_LENGTH = 40;

/** Joined terms are capped well below whisper's ~224-token prompt limit */
export const MAX_PROMPT_TERMS_LENGTH = 150;

/**
 * What a vocabulary turns into: the prompt sentence and which terms it names.
 */
export interface VocabularyPromptPlan {
  /** The prompt sentence, or null when no term is used */
  prompt: string | null;
  /** Terms named in the prompt, trimmed, in order */
  included: string[];
  /** Terms left out because they would exceed MAX_PROMPT_TERMS_LENGTH */
  skipped: string[];
}

/**
 * Plan the prompt for a vocabulary.
 * Terms are trimmed and de-duplicated case-insensitively (first spelling wins);
 * a term that would exceed the length cap is skipped, and later terms that still fit are kept.
 */
export function planVocabularyPrompt(terms: readonly string[]): VocabularyPromptPlan {
  const seen = new Set<string>();
  const included: string[] = [];
  const skipped: string[] = [];
  let length = 0;

  for (const raw of terms) {
    const term = raw.trim();
    const key = term.toLocaleLowerCase();
    if (term === '' || seen.has(key)) continue;
    seen.add(key);
    if (length + term.length > MAX_PROMPT_TERMS_LENGTH) {
      skipped.push(term);
      continue;
    }
    included.push(term);
    length += term.length;
  }

  if (included.length === 0) return { prompt: null, included, skipped };
  const listed = included.length === 1
    ? included[0]
    : `${included.slice(0, -1).join('、')} 和 ${included[included.length - 1]}`;
  return { prompt: `這段話可能會提到 ${listed}。`, included, skipped };
}

/**
 * Build the prompt sentence, or null when there is no usable term.
 */
export function buildVocabularyPrompt(terms: readonly string[]): string | null {
  return planVocabularyPrompt(terms).prompt;
}
