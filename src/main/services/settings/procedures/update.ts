/**
 * Validate and atomically persist the provided settings overrides.
 */

import log from 'electron-log';
import { sql } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { settings } from '../../../db/schema';
import type { AppSettings } from '../../../../shared/types/settings';
import { isSettingKey, settingsPatchSchema, type SettingsEnvironment, type SettingsResult } from '../types';
import { getSettings } from './get';

const logger = log.scope('settings:update');

export function updateSettings(
  db: AppDatabase,
  patch: unknown,
  now: () => number,
  env: SettingsEnvironment,
): SettingsResult<AppSettings> {
  const parsed = settingsPatchSchema.safeParse(patch);
  if (parsed.success === false) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  try {
    const updatedAt = now();
    db.transaction((tx) => {
      for (const [section, values] of Object.entries(parsed.data)) {
        if (values === undefined) continue;
        for (const [name, value] of Object.entries(values)) {
          if (value === undefined) continue;
          const key = `${section}.${name}`;
          if (!isSettingKey(key)) throw new Error('Unsupported setting key');
          // Bind JSON explicitly: Drizzle otherwise writes nullable values as SQL NULL.
          const storedValue = sql`${JSON.stringify(value)}`;
          tx.insert(settings).values({ key, value: storedValue, updatedAt }).onConflictDoUpdate({
            target: settings.key,
            set: { value: storedValue, updatedAt },
          }).run();
        }
      }
    });
    return getSettings(db, env);
  } catch (error) {
    logger.error('Failed to update settings', { error });
    return { success: false, error: 'Failed to update settings' };
  }
}
