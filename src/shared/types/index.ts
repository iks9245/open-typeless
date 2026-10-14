/**
 * Shared type definitions.
 * Re-exports all types for convenient importing.
 */

export type {
  ASRConfig,
  ASRResult,
  ASRStatus,
  AudioChunk,
} from './asr';

export type { AppSettings, AppSettingsPatch } from './settings';
export type {
  TranscriptionItem,
  ListHistoryInput,
  ListHistoryResult,
  HistoryChange,
} from './history';
