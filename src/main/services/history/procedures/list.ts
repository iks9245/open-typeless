/**
 * Renderer-safe history listing with stable keyset pagination and literal search.
 */

import log from 'electron-log';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import type { ListHistoryResult } from '../../../../shared/types/history';
import { decodeHistoryCursor, encodeHistoryCursor, listHistoryInputSchema, type HistoryResult } from '../types';
import { toTranscriptionItem } from '../lib/records';

const logger = log.scope('history:list');

export function listHistory(db: AppDatabase, input: unknown = {}): HistoryResult<ListHistoryResult> {
  const parsed = listHistoryInputSchema.safeParse(input);
  if (parsed.success === false) return { success: false, error: parsed.error.issues[0].message };
  try {
    const { cursor, query, status } = parsed.data;
    const limit = parsed.data.limit ?? 50;
    const decoded = cursor === undefined ? null : decodeHistoryCursor(cursor);
    const pattern = query === undefined ? undefined : `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = db.select().from(transcriptions).where(and(
      status === undefined ? undefined : eq(transcriptions.status, status),
      pattern === undefined ? undefined : sql`${transcriptions.finalText} LIKE ${pattern} ESCAPE '\\'`,
      decoded === null ? undefined : or(
        lt(transcriptions.createdAt, decoded.createdAt),
        and(eq(transcriptions.createdAt, decoded.createdAt), lt(transcriptions.id, decoded.id)),
      ),
    )).orderBy(desc(transcriptions.createdAt), desc(transcriptions.id)).limit(limit + 1).all();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      success: true,
      data: {
        items: page.map(toTranscriptionItem),
        nextCursor: rows.length > limit && last
          ? encodeHistoryCursor({ createdAt: last.createdAt, id: last.id }) : null,
      },
    };
  } catch (error) {
    logger.error('Failed to list history', { error });
    return { success: false, error: 'Failed to list history' };
  }
}
