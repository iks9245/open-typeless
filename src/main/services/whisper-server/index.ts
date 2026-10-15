/**
 * Application whisper.cpp facade with lazy Electron paths and current settings.
 */

import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { settingsService } from '../settings';
import { commandOf, processAlive } from './lib/ownership';
import { WhisperServerService } from './whisper-server.service';
import { listModels, type WhisperModelDependencies } from './lib/models';
import type { WhisperModelInfo } from '../../../shared/types/whisper-server';

const logger = log.scope('whisper-server');

export * from './types';
export { WhisperServerService } from './whisper-server.service';

const modelDependencies: WhisperModelDependencies = {
  homedir,
  userData: () => app.getPath('userData'),
  readDirectory: directory => readdirSync(directory),
  statFile: file => statSync(file),
  readHeader: file => {
    const fd = openSync(file, 'r');
    try {
      const header = Buffer.alloc(4);
      return header.subarray(0, readSync(fd, header, 0, 4, 0));
    } finally { closeSync(fd); }
  },
};

export function listWhisperModels(): WhisperModelInfo[] {
  return listModels(modelDependencies);
}

export function ensureModelsFolder(): string {
  const directory = path.join(app.getPath('userData'), 'models');
  mkdirSync(directory, { recursive: true });
  return directory;
}

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
    ...modelDependencies,
    env: process.env,
    fileExists: candidate => {
      try { return existsSync(candidate) && statSync(candidate).isFile(); } catch { return false; }
    },
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
  getModel: () => {
    const result = settingsService.get();
    selectedModel = result.success === true ? result.data.asr.model : null;
    return selectedModel;
  },
  logger,
});

const lastModel = settingsService.get();
let selectedModel = lastModel.success === true ? lastModel.data.asr.model : null;
settingsService.on('changed', settings => {
  if (settings.asr.model === selectedModel) return;
  selectedModel = settings.asr.model;
  void whisperServerService.modelChanged().catch(error => logger.error('Failed to switch whisper model', { error }));
});
