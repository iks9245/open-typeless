/**
 * Delete a history entry and its optional audio file.
 */

import log from 'electron-log';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import { historyRecordInputSchema, type AudioDependencies, type HistoryResult } from '../types';
import { deleteAudio } from '../lib/audio-store';
import { notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:delete');

export async function deleteHistory(
  db: AppDatabase,
  input: unknown,
  deps: AudioDependencies,
): Promise<HistoryResult<{ deleted: boolean }>> {
  const parsed = historyRecordInputSchema.safeParse(input);
  if (parsed.success === false) return { success: false, error: parsed.error.issues[0].message };
  try {
    const row = db.delete(transcriptions).where(eq(transcriptions.id, parsed.data))
      .returning({ audioPath: transcriptions.audioPath }).get();
    if (!row) return { success: true, data: { deleted: false } };
    notifyHistoryChanged(deps, { id: parsed.data, kind: 'deleted' });
    if (row.audioPath) await deleteAudio(deps.audioDir, row.audioPath);
    return { success: true, data: { deleted: true } };
  } catch (error) {
    logger.error('Failed to delete history', { error });
    return { success: false, error: 'Failed to delete history' };
  }
}
