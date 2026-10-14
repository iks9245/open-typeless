/**
 * Best-effort creation of a recording history entry.
 */

import log from 'electron-log';
// uuid 13 exposes package exports; the project's legacy ESLint resolver cannot resolve them.
// eslint-disable-next-line import/no-unresolved
import { v7 as uuidv7 } from 'uuid';
import type { AppDatabase } from '../../../db/client';
import { transcriptions } from '../../../db/schema';
import { beginHistoryInputSchema, type BeginDependencies } from '../types';
import { notifyHistoryChanged } from '../lib/records';

const logger = log.scope('history:begin');

export function beginHistory(db: AppDatabase, input: unknown, deps: BeginDependencies): string | null {
  try {
    if (!deps.settings.history.enabled) return null;
    const parsed = beginHistoryInputSchema.safeParse(input);
    if (parsed.success === false) {
      logger.warn('Invalid recording input', { error: parsed.error.issues[0].message });
      return null;
    }
    const id = uuidv7();
    const timestamp = deps.now();
    db.insert(transcriptions).values({
      ...parsed.data,
      id,
      status: 'recording',
      createdAt: timestamp,
      updatedAt: timestamp,
      appVersion: deps.appVersion,
    }).run();
    notifyHistoryChanged(deps, { id, kind: 'created' });
    return id;
  } catch (error) {
    logger.error('Failed to begin history recording', { error });
    return null;
  }
}
