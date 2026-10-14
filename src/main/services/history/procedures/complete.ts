/**
 * Best-effort completion of an active transcription and optional WAV storage.
 * An audio failure never changes the completed transcription outcome.
 */

import log from 'electron-log';
import { and, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import { completeHistoryInputSchema, historyIdSchema, type AudioDependencies } from '../types';
import { activeHistoryWhere, notifyHistoryChanged } from '../lib/records';
import { deleteAudio, writeAudio } from '../lib/audio-store';

const logger = log.scope('history:complete');

export async function completeHistory(
  db: AppDatabase,
  id: string | null,
  input: unknown,
  deps: AudioDependencies,
): Promise<boolean> {
  try {
    if (id === null || !deps.settings.history.enabled) return false;
    const parsedId = historyIdSchema.safeParse(id);
    const parsed = completeHistoryInputSchema.safeParse(input);
    if (parsedId.success === false || parsed.success === false) {
      const error = parsedId.success === false ? parsedId.error : parsed.success === false ? parsed.error : null;
      logger.warn('Invalid history completion input', { error: error?.issues[0].message });
      return false;
    }
    const data = parsed.data;
    const row = db.update(transcriptions).set({
      status: data.finalText.trim() === '' ? 'empty' : 'completed',
      rawText: data.rawText,
      finalText: data.finalText,
      audioDurationMs: Math.round(data.audioDurationMs),
      latencyMs: Math.round(data.latencyMs),
      detectedLanguage: data.detectedLanguage,
      ...(data.engineModel !== undefined ? { engineModel: data.engineModel } : {}),
      insertStatus: data.insert?.status ?? null,
      errorMessage: data.insert?.error ?? null,
      updatedAt: deps.now(),
    }).where(activeHistoryWhere(id)).returning({ createdAt: transcriptions.createdAt }).get();
    if (!row) return false;
    notifyHistoryChanged(deps, { id, kind: 'updated' });

    if (data.wav && deps.settings.history.saveAudio) {
      let relativePath: string | null = null;
      try {
        relativePath = await writeAudio(deps.audioDir, id, row.createdAt, data.wav);
        const result = db.update(transcriptions).set({ audioPath: relativePath, updatedAt: deps.now() })
          .where(and(eq(transcriptions.id, id), isNull(transcriptions.audioPath))).run();
        if (result.changes === 0) {
          // A delete/clear/prune may have won while the filesystem write awaited.
          await deleteAudio(deps.audioDir, relativePath);
        } else {
          notifyHistoryChanged(deps, { id, kind: 'updated' });
        }
      } catch (error) {
        logger.warn('Failed to save history audio', { id, error });
        if (relativePath !== null) {
          try {
            await deleteAudio(deps.audioDir, relativePath);
          } catch (cleanupError) {
            logger.warn('Failed to remove unreferenced history audio', { id, error: cleanupError });
          }
        }
      }
    }
    return true;
  } catch (error) {
    logger.error('Failed to complete history recording', { error });
    return false;
  }
}
