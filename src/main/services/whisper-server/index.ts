/**
 * Application whisper.cpp facade with lazy Electron paths and current settings.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { settingsService } from '../settings';
import { commandOf, processAlive } from './lib/ownership';
import { WhisperServerService } from './whisper-server.service';

const logger = log.scope('whisper-server');

export * from './types';
export { WhisperServerService } from './whisper-server.service';

export const whisperServerService = new WhisperServerService({
  spawn,
  healthCheck: async (url, signal) => {
    const response = await fetch(url, { signal, redirect: 'manual' });
    // Health probes only need headers; release any response body immediately.
    void response.body?.cancel().catch(error => logger.debug('Failed to release health response', { error }));
    return response.status === 200;
  },
  timers: { setTimeout, clearTimeout },
  now: Date.now,
  discovery: {
    env: process.env,
    homedir,
    fileExists: candidate => {
      try { return existsSync(candidate) && statSync(candidate).isFile(); } catch { return false; }
    },
    readDirectory: directory => readdirSync(directory),
  },
  ownership: {
    readFile: file => readFile(file, 'utf8'),
    writeFile: (file, content) => writeFile(file, content, { mode: 0o600 }),
    unlink,
    processAlive,
    commandOf,
  },
  kill: (pid, signal) => { process.kill(pid, signal); },
  pidFilePath: () => path.join(app.getPath('userData'), 'whisper-server.pid'),
  getServerUrl: () => {
    const result = settingsService.get();
    return result.success === true ? result.data.asr.whisperServerUrl : 'http://localhost:8080';
  },
  logger,
});
