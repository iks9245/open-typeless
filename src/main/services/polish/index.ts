/** Local oMLX facade. Configuration and API keys stay in the main process. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import log from 'electron-log';
import { settingsService } from '../settings';
import { PolishService } from './polish.service';

export { PolishService } from './polish.service';
export type { PolishOutcome } from './types';

export const polishService = new PolishService({
  readFile: file => readFile(file, 'utf8'),
  env: process.env,
  homedir,
  fetch: globalThis.fetch,
  now: Date.now,
  timers: { setTimeout, clearTimeout },
  logger: log.scope('polish'),
  getSettings: () => settingsService.get(),
  settingsService,
});
