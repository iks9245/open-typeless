import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { clipboard } from 'electron';
import log from 'electron-log';
import { uIOhook, UiohookKey } from 'uiohook-napi';
import { keyboardService } from '../keyboard';
import { CommandService } from './command.service';
import { captureSelection } from './lib/selection';

export { CommandService } from './command.service';
export type { CommandOutcome } from './types';

const logger = log.scope('command');
export const commandService = new CommandService({
  readFile: file => readFile(file, 'utf8'), env: process.env, homedir,
  fetch: globalThis.fetch, now: Date.now, timers: { setTimeout, clearTimeout }, logger,
  captureSelection: () => captureSelection({
    clipboard, logger, now: Date.now,
    waitForModifiersReleased: timeout => keyboardService.waitForModifiersReleased(timeout),
    keyTap: () => uIOhook.keyTap(UiohookKey.C, [UiohookKey.Meta]),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }),
});
