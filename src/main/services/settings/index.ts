/**
 * Settings facade for the application database and change subscriptions.
 * Caches merged settings until a successful update or database replacement.
 */

import { EventEmitter } from 'node:events';
import log from 'electron-log';
import { getDb, isDatabaseAvailable, type AppDatabase } from '../../db';
import type { AppSettings } from '../../../shared/types/settings';
import { getSettings, updateSettings } from './procedures';
import { emptySettingsInputSchema, getDefaultSettings, type SettingsResult, type SettingsService } from './types';

const logger = log.scope('settings');
const events = new EventEmitter();
let cache: { db: AppDatabase; settings: AppSettings } | null = null;

export { getDefaultSettings } from './types';

export const settingsService: SettingsService = {
  get(input: unknown = {}): SettingsResult<AppSettings> {
    const parsed = emptySettingsInputSchema.safeParse(input);
    if (parsed.success === false) return { success: false, error: parsed.error.issues[0].message };
    if (!isDatabaseAvailable()) {
      cache = null;
      return { success: true, data: getDefaultSettings() };
    }
    try {
      const db = getDb();
      if (cache?.db === db) return { success: true, data: structuredClone(cache.settings) };
      const result = getSettings(db, process.env);
      if (result.success === true) cache = { db, settings: structuredClone(result.data) };
      return result;
    } catch (error) {
      logger.error('Failed to read settings', { error });
      return { success: false, error: 'Failed to read settings' };
    }
  },

  update(patch: unknown): SettingsResult<AppSettings> {
    if (!isDatabaseAvailable()) return { success: false, error: 'Settings storage is unavailable' };
    try {
      const result = updateSettings(getDb(), patch, Date.now, process.env);
      if (result.success === true) {
        cache = null;
        for (const listener of events.rawListeners('changed')) {
          try {
            listener.call(events, structuredClone(result.data));
          } catch (error) {
            logger.warn('Settings change listener failed', { error });
          }
        }
      }
      return result;
    } catch (error) {
      logger.error('Failed to update settings', { error });
      return { success: false, error: 'Failed to update settings' };
    }
  },

  on(event: 'changed', listener: (settings: AppSettings) => void): SettingsService {
    events.on(event, listener);
    return settingsService;
  },

  off(event: 'changed', listener: (settings: AppSettings) => void): SettingsService {
    events.off(event, listener);
    return settingsService;
  },
};
