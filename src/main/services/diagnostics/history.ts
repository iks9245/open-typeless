import { count, desc } from 'drizzle-orm';
import type { AppDatabase } from '../../db/client';
import { transcriptions } from '../../db/schema';

/** Explicit projection: content, audio paths, metadata and row IDs never enter the report. */
export function collectHistory(db: AppDatabase | null) {
  if (!db) return { counts: { status: [], mode: [], errorCode: [], insertStatus: [] }, recent: [] };
  const counts = {
    status: db.select({ status: transcriptions.status, count: count() }).from(transcriptions).groupBy(transcriptions.status).all(),
    mode: db.select({ mode: transcriptions.mode, count: count() }).from(transcriptions).groupBy(transcriptions.mode).all(),
    errorCode: db.select({ errorCode: transcriptions.errorCode, count: count() }).from(transcriptions).groupBy(transcriptions.errorCode).all(),
    insertStatus: db.select({ insertStatus: transcriptions.insertStatus, count: count() }).from(transcriptions).groupBy(transcriptions.insertStatus).all(),
  };
  const recent = db.select({
    createdAt: transcriptions.createdAt, status: transcriptions.status, mode: transcriptions.mode,
    audioDurationMs: transcriptions.audioDurationMs, latencyMs: transcriptions.latencyMs,
    errorCode: transcriptions.errorCode, errorMessage: transcriptions.errorMessage,
    insertStatus: transcriptions.insertStatus, engineModel: transcriptions.engineModel,
  }).from(transcriptions).orderBy(desc(transcriptions.createdAt), desc(transcriptions.id)).limit(50).all()
    .map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() }));
  return { counts, recent };
}

/** Only the newest rows can appear in the 2 MB log tails, and each value costs a full scan */
export const PRIVATE_HISTORY_ROWS = 1000;

/** Main-only denylist for accidental content in logs/errors; never written to the archive. */
export function historyPrivateValues(db: AppDatabase | null): string[] {
  if (!db) return [];
  return db.select({ id: transcriptions.id, rawText: transcriptions.rawText, finalText: transcriptions.finalText, audioPath: transcriptions.audioPath })
    .from(transcriptions).orderBy(desc(transcriptions.createdAt)).limit(PRIVATE_HISTORY_ROWS).all()
    .flatMap(row => [row.id, row.rawText, row.finalText, row.audioPath])
    .filter((value): value is string => Boolean(value));
}
