/**
 * Best-effort update of text insertion status.
 */

import log from 'electron-log';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import type { InsertStatus } from '../../../../shared/constants/history';
import { historyIdSchema, insertHistoryInputSchema, type HistoryWriteDependencies } from '../types';
import { notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:mark-inserted');

export function markHistoryInserted(
  db: AppDatabase,
  id: string | null,
  status: InsertStatus,
  error: string | undefined,
  deps: HistoryWriteDependencies,
): boolean {
  try {
    if (id === null || !deps.settings.history.enabled) return false;
    const parsedId = historyIdSchema.safeParse(id);
    const parsed = insertHistoryInputSchema.safeParse({ status, error });
    if (parsedId.success === false || parsed.success === false) {
      logger.warn('Invalid history insertion input');
      return false;
    }
    const result = db.update(transcriptions).set({
      insertStatus: status, errorMessage: error ?? null, updatedAt: deps.now(),
    }).where(eq(transcriptions.id, id)).run();
    if (result.changes === 0) return false;
    notifyHistoryChanged(deps, { id, kind: 'updated' });
    return true;
  } catch (caughtError) {
    logger.error('Failed to mark history insertion', { error: caughtError });
    return false;
  }
}
