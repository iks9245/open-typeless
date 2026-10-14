/**
 * Best-effort failure transition, restricted to active recordings.
 */

import log from 'electron-log';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import { failHistoryInputSchema, historyIdSchema, type HistoryWriteDependencies } from '../types';
import { activeHistoryWhere, notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:fail');

export function failHistory(
  db: AppDatabase,
  id: string | null,
  code: string,
  message: string,
  deps: HistoryWriteDependencies,
): boolean {
  try {
    if (id === null || !deps.settings.history.enabled) return false;
    const parsedId = historyIdSchema.safeParse(id);
    const parsed = failHistoryInputSchema.safeParse({ code, message });
    if (parsedId.success === false || parsed.success === false) {
      logger.warn('Invalid history failure input');
      return false;
    }
    const result = db.update(transcriptions).set({
      status: 'failed', errorCode: code, errorMessage: message, updatedAt: deps.now(),
    }).where(activeHistoryWhere(id)).run();
    if (result.changes === 0) return false;
    notifyHistoryChanged(deps, { id, kind: 'updated' });
    return true;
  } catch (error) {
    logger.error('Failed to mark history failed', { error });
    return false;
  }
}
