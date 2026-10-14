/**
 * Best-effort transition of an active recording to processing.
 */

import log from 'electron-log';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import { historyIdSchema, type HistoryWriteDependencies } from '../types';
import { activeHistoryWhere, notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:mark-processing');

export function markHistoryProcessing(db: AppDatabase, id: string | null, deps: HistoryWriteDependencies): boolean {
  try {
    if (id === null || !deps.settings.history.enabled) return false;
    const parsed = historyIdSchema.safeParse(id);
    if (parsed.success === false) {
      logger.warn('Invalid history identifier', { error: parsed.error.issues[0].message });
      return false;
    }
    const result = db.update(transcriptions).set({ status: 'processing', updatedAt: deps.now() })
      .where(activeHistoryWhere(id)).run();
    if (result.changes === 0) return false;
    notifyHistoryChanged(deps, { id, kind: 'updated' });
    return true;
  } catch (error) {
    logger.error('Failed to mark history processing', { error });
    return false;
  }
}
