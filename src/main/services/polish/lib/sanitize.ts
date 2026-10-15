/** Remove model wrappers before checking output length, counted in Unicode code points. */
export function acceptPolished(raw: string, output: string): { ok: true; text: string } | { ok: false; reason: string } {
  const text = stripWrappingQuotes(stripThinking(output.replace(/<\/?transcript>/gi, '')).trim(), raw);
  const rawLength = Array.from(raw).length;
  const length = Array.from(text).length;
  if (!length) return { ok: false, reason: 'empty' };
  if (length > rawLength * 1.5 + 20) return { ok: false, reason: 'too long' };
  if (rawLength >= 20 && length < rawLength * 0.3) return { ok: false, reason: 'too short' };
  return { ok: true, text };
}

/** Shared wrapper removal; polish retains its own tag and length rules. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<think>[\s\S]*$/i, '');
}

export function stripWrappingQuotes(text: string, raw = ''): string {
  for (const [open, close] of [['"', '"'], ['“', '”'], ['「', '」']]) {
    if (!raw.trimStart().startsWith(open) && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, -close.length).trim();
    }
  }
  return text;
}
