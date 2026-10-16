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
export type { IpcResult } from './common';
export type { WhisperServerInfo, WhisperModelInfo } from './whisper-server';
export type { PolishInfo, PolishUnavailableReason } from './polish';
export type {
  TranscriptionItem,
  ListHistoryInput,
  ListHistoryResult,
  HistoryChange,
} from './history';

export type { ReportRange, ReportInput, ReportTotals, FillerCount, WordCount, SpeechReport, ReportComment } from './report';

export type { AskResult, AskSource, AskEntry, MemoryStatus } from './memory';

export type { ModelCatalogEntry, ModelCatalogState, ModelDownloadProgress } from './model-download';
