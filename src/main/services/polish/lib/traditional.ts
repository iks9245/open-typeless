/**
 * Deterministic Simplified → Traditional (Taiwan) conversion for polished text.
 * The model is asked to write Traditional Chinese but does not always do so.
 */

import * as OpenCC from 'opencc-js';

const convert = OpenCC.Converter({ from: 'cn', to: 'tw' });

/**
 * Characters that OpenCC converts on their own but that are also standard in Traditional text
 * (台灣, 准許, 了解, 着數…). They alone never trigger a conversion.
 */
const SHARED_CHARACTERS = new Set('台准云丑着后里干余冲范几征斗于朴仆夸咸采咨游了');

/** Whether the text contains a character that only exists in Simplified Chinese. */
export function hasSimplifiedCharacters(text: string): boolean {
  for (const char of text) {
    if (!SHARED_CHARACTERS.has(char) && convert(char) !== char) return true;
  }
  return false;
}

/**
 * Convert text that contains Simplified characters to Traditional; other text is returned
 * unchanged, so Traditional and Cantonese output is never rewritten.
 */
export function toTraditional(text: string): string {
  if (!hasSimplifiedCharacters(text)) return text;
  const converted = convert(text);
  const source = Array.from(text);
  const target = Array.from(converted);
  // Keep the common 台 rather than OpenCC's 臺 when positions still line up
  if (source.length !== target.length) return converted;
  return target.map((char, index) => (source[index] === '台' ? '台' : char)).join('');
}
