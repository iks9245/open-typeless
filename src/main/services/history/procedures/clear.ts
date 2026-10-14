/**
 * Clear transcription history and all stored WAV files, including orphans.
 */

import log from 'electron-log';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import { clearHistoryInputSchema, type AudioDependencies, type HistoryResult } from '../types';
import { clearAudio } from '../lib/audio-store';
import { notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:clear');

export async function clearHistory(
  db: AppDatabase,
  input: unknown,
  deps: AudioDependencies,
): Promise<HistoryResult<{ deleted: number }>> {
  const parsed = clearHistoryInputSchema.safeParse(input);
  if (parsed.success === false) return { success: false, error: parsed.error.issues[0].message };
  try {
    const result = db.delete(transcriptions).run();
    notifyHistoryChanged(deps, { id: null, kind: 'cleared' });
    await clearAudio(deps.audioDir);
    return { success: true, data: { deleted: result.changes } };
  } catch (error) {
    logger.error('Failed to clear history', { error });
    return { success: false, error: 'Failed to clear history' };
  }
}
