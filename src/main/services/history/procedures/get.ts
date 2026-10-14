/**
 * Fetch one transcription without exposing filesystem paths or metadata.
 */

import log from 'electron-log';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import type { TranscriptionItem } from '../../../../shared/types/history';
import { historyRecordInputSchema, type HistoryResult } from '../types';
import { toTranscriptionItem } from '../lib/records';

const logger = log.scope('history:get');

export function getHistory(db: AppDatabase, input: unknown): HistoryResult<TranscriptionItem | null> {
  const parsed = historyRecordInputSchema.safeParse(input);
  if (parsed.success === false) return { success: false, error: parsed.error.issues[0].message };
  try {
    const row = db.select().from(transcriptions).where(eq(transcriptions.id, parsed.data)).get();
    return { success: true, data: row ? toTranscriptionItem(row) : null };
  } catch (error) {
    logger.error('Failed to get history', { error });
    return { success: false, error: 'Failed to get history' };
  }
}
