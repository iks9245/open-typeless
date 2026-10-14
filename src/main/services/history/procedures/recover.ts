/**
 * Recover recordings interrupted before reaching a terminal status.
 */

import log from 'electron-log';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import type { HistoryWriteDependencies } from '../types';
import { activeHistoryWhere, notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:recover');

export function recoverHistory(db: AppDatabase, deps: HistoryWriteDependencies): number {
  try {
    // Runs even when history is disabled: interrupted rows must still reach a terminal status.
    const rows = db.update(transcriptions).set({
      status: 'failed', errorCode: 'interrupted', updatedAt: deps.now(),
    }).where(activeHistoryWhere()).returning({ id: transcriptions.id }).all();
    for (const row of rows) notifyHistoryChanged(deps, { id: row.id, kind: 'updated' });
    return rows.length;
  } catch (error) {
    logger.error('Failed to recover history', { error });
    return 0;
  }
}
