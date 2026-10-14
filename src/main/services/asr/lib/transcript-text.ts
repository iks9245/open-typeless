/**
 * Normalizes whisper.cpp transcript text before it is inserted at the cursor.
 */

// Han, kana, Hangul and CJK/full-width punctuation: written without spaces between them.
// Built from escapes so the source has no invisible characters such as U+3000.
const CJK = new RegExp('[\\u3000-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff\\uff00-\\uffef]');

// A line break with the spaces/tabs around it (and any further blank lines)
const SEGMENT_BREAK = /[ \t]*\r?\n\s*/g;

/**
 * Join the line breaks whisper.cpp puts between segments, so a long dictation is not
 * inserted with newlines in the middle of a sentence. Breaks between CJK characters
 * are removed; other breaks become a single space. Leading/trailing whitespace is trimmed;
 * spacing elsewhere is left unchanged.
 */
export function joinSegments(text: string): string {
  // Look at the neighbors without consuming them, so consecutive breaks each see theirs
  return text.trim().replace(SEGMENT_BREAK, (match: string, offset: number, source: string) => {
    const before = source.charAt(offset - 1);
    const after = source.charAt(offset + match.length);
    return CJK.test(before) && CJK.test(after) ? '' : ' ';
  });
}
