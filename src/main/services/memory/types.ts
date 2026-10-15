import { z } from 'zod';
import type { AppDatabase } from '../../db/client';
import type { PolishDependencies } from '../polish/types';
import type { SettingsService } from '../settings/types';
import type { HistoryChange } from '../../../shared/types/history';

export const askInputSchema = z.object({ question: z.string().trim().min(1).max(500) }).strict();
export type MemoryDependencies = Pick<PolishDependencies,
  'readFile' | 'env' | 'homedir' | 'logger' | 'fetch' | 'now' | 'timers' | 'getSettings'> & {
  getDb(): AppDatabase;
};
export type IndexerDependencies = MemoryDependencies & {
  subscribeHistory(listener: (change: HistoryChange) => void): () => void;
  settingsService: Pick<SettingsService, 'on' | 'off'>;
};
