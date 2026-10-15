/**
 * SQLite database schema.
 * Defines transcription history and user settings with Drizzle.
 */

import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  ASR_ENGINES,
  INSERT_STATUSES,
  TRANSCRIPTION_MODES,
  TRANSCRIPTION_STATUSES,
} from '../../shared/constants/history';

export const transcriptions = sqliteTable('transcriptions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  status: text('status', { enum: TRANSCRIPTION_STATUSES }).notNull(),
  mode: text('mode', { enum: TRANSCRIPTION_MODES }).notNull().default('dictation'),
  rawText: text('raw_text'),
  finalText: text('final_text'),
  language: text('language'),
  detectedLanguage: text('detected_language'),
  audioDurationMs: integer('audio_duration_ms'),
  latencyMs: integer('latency_ms'),
  engine: text('engine', { enum: ASR_ENGINES }).notNull(),
  engineModel: text('engine_model'),
  /** Path relative to the audio directory. */
  audioPath: text('audio_path'),
  insertStatus: text('insert_status', { enum: INSERT_STATUSES }),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  appVersion: text('app_version').notNull(),
  meta: text('meta', { mode: 'json' }).$type<Record<string, unknown>>(),
}, (table) => [
  index('idx_transcriptions_created_at').on(table.createdAt, table.id),
  index('idx_transcriptions_status_created_at').on(table.status, table.createdAt),
]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type Transcription = typeof transcriptions.$inferSelect;
export type NewTranscription = typeof transcriptions.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;

/** Local, disposable vectors; source deletion is enforced by SQLite. */
export const historyEmbeddings = sqliteTable('history_embeddings', {
  id: text('id').primaryKey(),
  transcriptionId: text('transcription_id').notNull().references(() => transcriptions.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  model: text('model').notNull(),
  dim: integer('dim').notNull(),
  vector: blob('vector', { mode: 'buffer' }).notNull(),
  textHash: text('text_hash').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_history_embeddings_transcription_id').on(table.transcriptionId),
  index('idx_history_embeddings_model').on(table.model),
]);
