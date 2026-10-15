import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import log from 'electron-log';
import { getDb } from '../../db';
import { settingsService } from '../settings';
import { ReportService } from './report.service';

export const reportService = new ReportService({
  getDb, now: Date.now, readFile: file => readFile(file, 'utf8'), env: process.env, homedir,
  fetch: globalThis.fetch, timers: { setTimeout, clearTimeout }, logger: log.scope('report'),
  getSettings: () => settingsService.get(),
});
