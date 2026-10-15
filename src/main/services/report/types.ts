import { z } from 'zod';
import type { Transcription } from '../../db/schema';
import type { AppDatabase } from '../../db/client';
import type { PolishDependencies } from '../polish/types';

export const reportInputSchema = z.object({ range: z.enum(['week', 'month', 'all']) }).strict();
export type ReportRow = Pick<Transcription, 'createdAt' | 'mode' | 'rawText' | 'finalText' | 'audioDurationMs' | 'latencyMs'>;
export type ReportDependencies = Pick<PolishDependencies,
  'readFile' | 'env' | 'homedir' | 'logger' | 'fetch' | 'now' | 'timers' | 'getSettings'> & {
  getDb(): AppDatabase;
};
