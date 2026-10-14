/**
 * Shared history predicates, renderer projection, and change notification.
 */

import log from 'electron-log';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { transcriptions, type Transcription } from '../../../db/schema';
import type { HistoryChange, TranscriptionItem } from '../../../../shared/types/history';
import type { HistoryWriteDependencies } from '../types';

const logger = log.scope('history:records');

export function activeHistoryWhere(id?: string): SQL | undefined {
  return and(
    id === undefined ? undefined : eq(transcriptions.id, id),
    inArray(transcriptions.status, ['recording', 'processing']),
  );
}

export function notifyHistoryChanged(
  deps: Pick<HistoryWriteDependencies, 'onChanged'>,
  change: HistoryChange,
): void {
  try {
    deps.onChanged?.(change);
  } catch (error) {
    logger.warn('History change listener failed', { error });
  }
}

export function toTranscriptionItem(row: Transcription): TranscriptionItem {
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: row.status,
    mode: row.mode,
    rawText: row.rawText,
    finalText: row.finalText,
    language: row.language,
    detectedLanguage: row.detectedLanguage,
    audioDurationMs: row.audioDurationMs,
    latencyMs: row.latencyMs,
    engine: row.engine,
    engineModel: row.engineModel,
    insertStatus: row.insertStatus,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    appVersion: row.appVersion,
    hasAudio: row.audioPath !== null,
  };
}
