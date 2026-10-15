/** Remove model wrappers before checking output length, counted in Unicode code points. */
export function acceptPolished(raw: string, output: string): { ok: true; text: string } | { ok: false; reason: string } {
  let text = output.replace(/<\/?transcript>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<think>[\s\S]*$/i, '')
    .trim();
  for (const [open, close] of [['"', '"'], ['“', '”'], ['「', '」']]) {
    if (!raw.trimStart().startsWith(open) && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, -close.length).trim();
    }
  }
  const rawLength = Array.from(raw).length;
  const length = Array.from(text).length;
  if (!length) return { ok: false, reason: 'empty' };
  if (length > rawLength * 1.5 + 20) return { ok: false, reason: 'too long' };
  if (rawLength >= 20 && length < rawLength * 0.3) return { ok: false, reason: 'too short' };
  return { ok: true, text };
}
