/**
 * Renderer-safe transcription history types.
 * Filesystem paths and session metadata are never exposed to the renderer.
 */

import type {
  ASREngine,
  InsertStatus,
  TranscriptionMode,
  TranscriptionStatus,
} from '../constants/history';

export interface TranscriptionItem {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: TranscriptionStatus;
  mode: TranscriptionMode;
  rawText: string | null;
  finalText: string | null;
  language: string | null;
  detectedLanguage: string | null;
  audioDurationMs: number | null;
  latencyMs: number | null;
  engine: ASREngine;
  engineModel: string | null;
  insertStatus: InsertStatus | null;
  errorCode: string | null;
  errorMessage: string | null;
  appVersion: string;
  hasAudio: boolean;
}

export interface ListHistoryInput {
  cursor?: string;
  limit?: number;
  query?: string;
  status?: TranscriptionStatus;
}

export interface ListHistoryResult {
  items: TranscriptionItem[];
  nextCursor: string | null;
}

export interface HistoryChange {
  id: string | null;
  kind: 'created' | 'updated' | 'deleted' | 'cleared';
}
