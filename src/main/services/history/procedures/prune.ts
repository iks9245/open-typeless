/**
 * Prune expired transcriptions and their audio files without blocking startup.
 */

import log from 'electron-log';
import { lt } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import { retentionDaysSchema, type AudioDependencies } from '../types';
import { deleteAudio } from '../lib/audio-store';
import { notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:prune');

export async function pruneHistory(db: AppDatabase, retentionDays: number | null, deps: AudioDependencies): Promise<number> {
  try {
    // Retention applies even when history is disabled, so stored rows never outlive it.
    if (retentionDays === null) return 0;
    const parsed = retentionDaysSchema.safeParse(retentionDays);
    if (parsed.success === false) {
      logger.warn('Invalid history retention', { error: parsed.error.issues[0].message });
      return 0;
    }
    const rows = db.delete(transcriptions).where(lt(transcriptions.createdAt, deps.now() - retentionDays * 86400000))
      .returning({ id: transcriptions.id, audioPath: transcriptions.audioPath }).all();
    for (const row of rows) {
      notifyHistoryChanged(deps, { id: row.id, kind: 'deleted' });
      if (row.audioPath) {
        try {
          await deleteAudio(deps.audioDir, row.audioPath);
        } catch (error) {
          logger.warn('Failed to prune history audio', { id: row.id, error });
        }
      }
    }
    return rows.length;
  } catch (error) {
    logger.error('Failed to prune history', { error });
    return 0;
  }
}
