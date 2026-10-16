import { randomUUID } from 'node:crypto';

/** Structural clipboard interface keeps Electron out of selection tests. */
export interface SelectionDependencies<Image extends { isEmpty(): boolean } = { isEmpty(): boolean }> {
  clipboard: {
    availableFormats(): string[];
    readText(): string;
    readHTML(): string;
    readRTF(): string;
    readImage(): Image;
    writeText(text: string): void;
    write(data: { text?: string; html?: string; rtf?: string; image?: Image }): void;
    clear(): void;
  };
  waitForModifiersReleased(timeoutMs: number): Promise<boolean>;
  keyTap(): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  logger: { warn(message: string): void };
}

export async function captureSelection<Image extends { isEmpty(): boolean }>(deps: SelectionDependencies<Image>): Promise<string | null> {
  if (!(await deps.waitForModifiersReleased(1500))) throw new Error('Release Shift to run the command');
  const formats = deps.clipboard.availableFormats();
  const snapshot = {
    text: deps.clipboard.readText(), html: deps.clipboard.readHTML(),
    rtf: deps.clipboard.readRTF(), image: deps.clipboard.readImage(),
  };
  const unknown = formats.filter(format => !/^(text\/(plain|html|rtf)|image\/[^/]+)$/i.test(format));
  if (unknown.length) deps.logger.warn(`Clipboard formats cannot be restored: ${unknown.join(', ')}`);
  const sentinel = `waae-selection-${randomUUID()}`;
  try {
    deps.clipboard.writeText(sentinel);
    deps.keyTap();
    const started = deps.now();
    do {
      await deps.sleep(20);
      const text = deps.clipboard.readText();
      if (text !== sentinel) return text;
    } while (deps.now() - started < 400);
    return null;
  } finally {
    // Write back only the flavors that existed: an empty HTML or RTF flavor would make apps
    // that prefer rich text paste nothing
    const restore = {
      ...(snapshot.text ? { text: snapshot.text } : {}),
      ...(snapshot.html ? { html: snapshot.html } : {}),
      ...(snapshot.rtf ? { rtf: snapshot.rtf } : {}),
      ...(snapshot.image.isEmpty() ? {} : { image: snapshot.image }),
    };
    if (Object.keys(restore).length) deps.clipboard.write(restore);
    else deps.clipboard.clear();
  }
}
