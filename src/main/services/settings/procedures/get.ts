/**
 * Read settings overrides and merge them with environment-aware defaults.
 * Invalid rows are isolated so one corrupt value cannot hide other overrides.
 */

import log from 'electron-log';
import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { settings } from '../../../db/schema';
import type { AppSettings } from '../../../../shared/types/settings';
import {
  applySetting,
  getDefaultSettings,
  isSettingKey,
  settingSchemas,
  type SettingsEnvironment,
  type SettingsResult,
} from '../types';

const logger = log.scope('settings:get');

export function getSettings(
  db: AppDatabase,
  env: SettingsEnvironment,
): SettingsResult<AppSettings> {
  const data = getDefaultSettings(env);
  try {
    // Read raw JSON to catch malformed JSON separately for each row.
    const rows = db.select({ key: settings.key, value: sql<string>`${settings.value}` }).from(settings).all();
    for (const row of rows) {
      if (!isSettingKey(row.key)) {
        logger.warn('Ignoring unknown setting', { key: row.key });
        continue;
      }
      try {
        const parsed = settingSchemas[row.key].safeParse(JSON.parse(row.value));
        if (parsed.success === false) {
          logger.warn('Ignoring invalid setting', { key: row.key, error: parsed.error.issues[0].message });
          continue;
        }
        applySetting(data, row.key, parsed.data);
      } catch {
        logger.warn('Ignoring malformed setting JSON', { key: row.key });
      }
    }
    return { success: true, data };
  } catch (error) {
    logger.error('Failed to read settings', { error });
    return { success: false, error: 'Failed to read settings' };
  }
}
