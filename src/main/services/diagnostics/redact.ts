/** Content shorter than this is not looked for in logs (see createRedactor) */
export const MIN_PRIVATE_VALUE_LENGTH = 6;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Operate on strings before JSON encoding, so escaped paths and quotes remain valid JSON. */
export function createRedactor(home: string, username: string, privateValues: readonly string[] = []): (text: string) => string {
  const userSegment = username ? new RegExp(`([/\\\\])${escapeRegExp(username)}(?=[/\\\\]|$|[\\s"'])`, 'g') : null;
  // Short values such as whisper's phantom "you" or 「好」 would shred unrelated log text
  const values = [...new Set(privateValues.filter(value => Array.from(value.trim()).length >= MIN_PRIVATE_VALUE_LENGTH)
    .flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length);
  return text => {
    let result = text;
    // Replace content before paths, since a private value may itself contain the home path.
    for (const value of values) result = result.split(value).join('[redacted]');
    if (home) result = result.split(home).join('~');
    if (userSegment) result = result.replace(userSegment, '$1~');
    return result
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[redacted]')
      .replace(/[^\s"'<>]+/g, token => /[/\\]/.test(token) && /\.(?:wav|mp3|m4a|flac|ogg|opus|pcm|webm)(?:[?#].*)?[),;:]*$/i.test(token) ? '[redacted]' : token)
      .replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[redacted]')
      .replace(/((?:api[_-]?key|access[_-]?token|password|secret)["']?\s*[:=]\s*["']?)[^\s"',}\]]+/gi, '$1[redacted]');
  };
}

export function redactJson<T>(value: T, redact: (text: string) => string): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string' ? redact(item) : item)) as T;
}
