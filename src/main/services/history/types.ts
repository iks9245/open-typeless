/**
 * History input schemas and explicit procedure dependencies.
 */

import { z } from 'zod';
import { ASR_ENGINES, INSERT_STATUSES, TRANSCRIPTION_MODES, TRANSCRIPTION_STATUSES } from '../../../shared/constants/history';
import type { HistoryChange, ListHistoryInput, ListHistoryResult, TranscriptionItem } from '../../../shared/types/history';
import type { InsertStatus } from '../../../shared/constants/history';
import type { AppSettings } from '../../../shared/types/settings';

export type HistoryResult<T> = { success: true; data: T } | { success: false; error: string };

export interface HistoryService {
  begin(input: BeginHistoryInput): string | null;
  markProcessing(id: string | null): boolean;
  complete(id: string | null, input: CompleteHistoryInput): Promise<boolean>;
  fail(id: string | null, code: string, message: string): boolean;
  markInserted(id: string | null, status: InsertStatus, error?: string): boolean;
  list(input?: unknown): HistoryResult<ListHistoryResult>;
  get(input: unknown): HistoryResult<TranscriptionItem | null>;
  delete(input: unknown): Promise<HistoryResult<{ deleted: boolean }>>;
  clear(input?: unknown): Promise<HistoryResult<{ deleted: number }>>;
  recover(): number;
  prune(retentionDays?: number | null): Promise<number>;
  on(event: 'changed', listener: (change: HistoryChange) => void): HistoryService;
  off(event: 'changed', listener: (change: HistoryChange) => void): HistoryService;
}

export interface HistoryWriteDependencies {
  now: () => number;
  settings: AppSettings;
  onChanged?: (change: HistoryChange) => void;
}

export interface BeginDependencies extends HistoryWriteDependencies {
  appVersion: string;
}

export interface AudioDependencies extends HistoryWriteDependencies {
  audioDir: string;
}

export const historyIdSchema = z.string().uuid();
export const historyRecordInputSchema = z.union([
  historyIdSchema,
  z.object({ id: historyIdSchema }).strict().transform((input) => input.id),
]);
export const clearHistoryInputSchema = z.object({}).strict();

export const transcriptionItemSchema: z.ZodType<TranscriptionItem> = z.object({
  id: historyIdSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  status: z.enum(TRANSCRIPTION_STATUSES),
  mode: z.enum(TRANSCRIPTION_MODES),
  rawText: z.string().nullable(),
  finalText: z.string().nullable(),
  language: z.string().nullable(),
  detectedLanguage: z.string().nullable(),
  audioDurationMs: z.number().nullable(),
  latencyMs: z.number().nullable(),
  engine: z.enum(ASR_ENGINES),
  engineModel: z.string().nullable(),
  insertStatus: z.enum(INSERT_STATUSES).nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  appVersion: z.string(),
  hasAudio: z.boolean(),
}).strict();

export const listHistoryResultSchema: z.ZodType<ListHistoryResult> = z.object({
  items: z.array(transcriptionItemSchema),
  nextCursor: z.string().nullable(),
}).strict();

export const beginHistoryInputSchema = z.object({
  mode: z.enum(TRANSCRIPTION_MODES).optional(),
  language: z.string().nullable().optional(),
  engine: z.enum(ASR_ENGINES),
  engineModel: z.string().nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type BeginHistoryInput = z.infer<typeof beginHistoryInputSchema>;

export const completeHistoryInputSchema = z.object({
  rawText: z.string(),
  finalText: z.string(),
  audioDurationMs: z.number().finite().nonnegative(),
  latencyMs: z.number().finite().nonnegative(),
  detectedLanguage: z.string().nullable(),
  engineModel: z.string().nullable().optional(),
  insert: z.object({ status: z.enum(INSERT_STATUSES), error: z.string().optional() }).strict().optional(),
  wav: z.instanceof(Buffer).nullable().optional(),
}).strict();
export type CompleteHistoryInput = z.infer<typeof completeHistoryInputSchema>;

export const failHistoryInputSchema = z.object({ code: z.string(), message: z.string() }).strict();
export const insertHistoryInputSchema = z.object({
  status: z.enum(INSERT_STATUSES), error: z.string().optional(),
}).strict();
export const retentionDaysSchema = z.number().int().positive().nullable();

const cursorDataSchema = z.object({
  createdAt: z.number().int().nonnegative().safe(),
  id: historyIdSchema,
}).strict();
export type HistoryCursor = z.infer<typeof cursorDataSchema>;

export function decodeHistoryCursor(cursor: string): HistoryCursor | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) return null;
    const parsed = cursorDataSchema.safeParse(JSON.parse(bytes.toString('utf8')));
    return parsed.success === true ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export const listHistoryInputSchema: z.ZodType<ListHistoryInput> = z.object({
  cursor: z.string().max(1024).refine((value) => decodeHistoryCursor(value) !== null, 'Invalid history cursor').optional(),
  limit: z.number().int().min(1).max(200).default(50),
  // A blank query means no search: LIKE '%%' would also drop rows whose text is NULL (failed sessions)
  query: z.string().trim().max(200).transform((value) => (value === '' ? undefined : value)).optional(),
  status: z.enum(TRANSCRIPTION_STATUSES).optional(),
}).strict();
