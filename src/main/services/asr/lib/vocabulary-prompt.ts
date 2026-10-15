/**
 * Builds the whisper.cpp prompt that biases recognition toward the user's vocabulary.
 *
 * Measured with synthesized Taiwanese Mandarin against large-v3-turbo (2026-10-15):
 * - no prompt: proper nouns misheard (e.g. "OpenT Plus", "Jenrys") and output in
 *   Simplified Chinese
 * - a comma-separated term list: little improvement, still Simplified
 * - a natural Traditional Chinese sentence naming the terms: "Open Typeless" recognized
 *   and output in Traditional Chinese, without inserting terms into unrelated sentences
 */

/** Joined terms are capped well below whisper's ~224-token prompt limit */
const MAX_TERMS_LENGTH = 150;

/**
 * Build the prompt sentence, or null when there is no usable term.
 * Terms are trimmed and de-duplicated case-insensitively (first spelling wins);
 * a term that would exceed the length cap is skipped, and later terms that still fit are kept.
 */
export function buildVocabularyPrompt(terms: readonly string[]): string | null {
  const seen = new Set<string>();
  const selected: string[] = [];
  let length = 0;

  for (const raw of terms) {
    const term = raw.trim();
    const key = term.toLocaleLowerCase();
    if (term === '' || seen.has(key)) continue;
    if (length + term.length > MAX_TERMS_LENGTH) continue;
    seen.add(key);
    selected.push(term);
    length += term.length;
  }

  if (selected.length === 0) return null;
  const listed = selected.length === 1
    ? selected[0]
    : `${selected.slice(0, -1).join('、')} 和 ${selected[selected.length - 1]}`;
  return `這段話可能會提到 ${listed}。`;
}
