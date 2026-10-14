/**
 * History data constants.
 * Shared values and types for transcription records.
 */

export const TRANSCRIPTION_STATUSES = ['recording', 'processing', 'completed', 'empty', 'failed'] as const;
export const TRANSCRIPTION_MODES = ['dictation', 'command'] as const;
export const INSERT_STATUSES = ['inserted', 'failed', 'skipped'] as const;
export const ASR_ENGINES = ['whisper.cpp', 'volcengine'] as const;

export type TranscriptionStatus = typeof TRANSCRIPTION_STATUSES[number];
export type TranscriptionMode = typeof TRANSCRIPTION_MODES[number];
export type InsertStatus = typeof INSERT_STATUSES[number];
export type ASREngine = typeof ASR_ENGINES[number];
