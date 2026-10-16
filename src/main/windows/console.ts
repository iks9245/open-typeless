import path from 'node:path';
import type { WebContents } from 'electron';
import log from 'electron-log';

/** Attach before loading either renderer, including errors during its initial mount. */
export function forwardConsoleErrors(contents: WebContents, role: 'main' | 'floating'): void {
  contents.on('console-message', (details) => {
    if (details.level !== 'error') return;
    let source = details.sourceId;
    try { source = new URL(source).pathname; } catch { /* May already be a file name. */ }
    log.error(`(renderer:${role})`, details.message, { file: path.basename(source), line: details.lineNumber });
  });
}
