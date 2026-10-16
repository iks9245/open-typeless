import { eq } from 'drizzle-orm';
import log from 'electron-log';
import type { AppDatabase } from '../../db';
import { updateSettings } from '../settings/procedures';
import { settings, transcriptions } from '../../db/schema';

const logger = log.scope('onboarding');

/** Run after storage initialization, before settings are cached or history is pruned. */
export function migrateExistingUser(db: AppDatabase, now: () => number = Date.now): void {
  try {
    db.transaction(tx => {
      if (tx.select({ key: settings.key }).from(settings).where(eq(settings.key, 'onboarding.completed')).get()) return;
      if (!tx.select({ id: transcriptions.id }).from(transcriptions).limit(1).get()) return;
      tx.insert(settings).values({ key: 'onboarding.completed', value: true, updatedAt: now() })
        .onConflictDoNothing().run();
    });
  } catch (error) {
    logger.error('Failed to migrate existing user onboarding', { error });
  }
}

/** Run only after legacy data moved, before settings are cached. Preserve all other choices. */
export function resetMigratedPermissions(db: AppDatabase, now: () => number = Date.now): void {
  try {
    const completed = db.select().from(settings).where(eq(settings.key, 'onboarding.completed')).get();
    if (completed?.value !== true) return;
    const result = updateSettings(db, {
      onboarding: { completed: false, step: 'microphone', migratedFromLegacy: true },
    }, now, {});
    if (!result.success) throw new Error(result.error);
  } catch (error) {
    logger.error('Failed to reset permissions after legacy migration', { error });
  }
}
