import type { AskResult, AskEntry, MemoryStatus } from '../shared/types/memory';
/**
 * Global type declarations for the Electron application.
 * Extends the Window interface with the exposed API.
 */

import type { ReportInput, SpeechReport } from '../shared/types/report';
import type { LoginItemState } from '../shared/types/system';
import type { InputMode } from '../shared/constants/command';
import type { ASRResult, ASRStatus } from '../shared/types/asr';
import type { IpcResult } from '../shared/types/common';
import type { HistoryChange, ListHistoryInput, ListHistoryResult, TranscriptionItem } from '../shared/types/history';
import type { PolishInfo } from '../shared/types/polish';
import type { AppSettings, AppSettingsPatch } from '../shared/types/settings';
import type { WhisperModelInfo, WhisperServerInfo } from '../shared/types/whisper-server';

/**
 * ASR API interface exposed via contextBridge.
 */
interface ASRApi {
  /**
   * Send audio chunk to main process.
   * @param chunk - Audio data as ArrayBuffer
   */
  sendAudio: (chunk: ArrayBuffer) => void;

  /**
   * Subscribe to ASR results.
   * @param callback - Called when ASR result is received
   * @returns Unsubscribe function
   */
  onResult: (callback: (result: ASRResult) => void) => () => void;

  /**
   * Subscribe to ASR status changes.
   * @param callback - Called when ASR status changes
   * @returns Unsubscribe function
   */
  onStatus: (callback: (status: ASRStatus) => void) => () => void;

  /**
   * Subscribe to ASR errors.
   * @param callback - Called when ASR error occurs
   * @returns Unsubscribe function
   */
  onError: (callback: (error: string) => void) => () => void;
}

/**
 * Floating Window API interface exposed via contextBridge.
 */
interface FloatingWindowApi {
  onAnswer: (callback: (result: AskResult) => void) => () => void;
  onMode: (callback: (mode: InputMode) => void) => () => void;
  /**
   * Set content height for adaptive window sizing.
   * @param height - Content height in pixels (from scrollHeight)
   */
  setContentHeight: (height: number) => void;
}

/**
 * History API interface exposed via contextBridge.
 */
interface HistoryApi {
  /**
   * List transcription history.
   * @param input - Optional pagination and filters
   */
  list: (input?: ListHistoryInput) => Promise<IpcResult<ListHistoryResult>>;

  /**
   * Get a transcription by ID.
   * @param id - Transcription ID
   */
  get: (id: string) => Promise<IpcResult<TranscriptionItem | null>>;

  /**
   * Delete a transcription and its saved audio.
   * @param id - Transcription ID
   */
  delete: (id: string) => Promise<IpcResult<{ deleted: boolean }>>;

  /**
   * Clear transcription history and saved audio.
   */
  clear: () => Promise<IpcResult<{ deleted: number }>>;

  /**
   * Subscribe to history changes.
   * @param callback - Called when history changes
   * @returns Unsubscribe function
   */
  onChanged: (callback: (change: HistoryChange) => void) => () => void;
}

/**
 * Settings API interface exposed via contextBridge.
 */
interface SettingsApi {
  /**
   * Get application settings, including defaults.
   */
  get: () => Promise<IpcResult<AppSettings>>;

  /**
   * Update application settings.
   * @param patch - Partial settings to update
   */
  update: (patch: AppSettingsPatch) => Promise<IpcResult<AppSettings>>;

  /**
   * Subscribe to settings changes.
   * @param callback - Called with the complete updated settings
   * @returns Unsubscribe function
   */
  onChanged: (callback: (settings: AppSettings) => void) => () => void;
}

/**
 * whisper.cpp server API interface exposed via contextBridge.
 */
interface WhisperServerApi {
  /**
   * Read the local whisper.cpp server status (file names only, no paths).
   */
  getStatus: () => Promise<IpcResult<WhisperServerInfo>>;
  listModels: () => Promise<IpcResult<WhisperModelInfo[]>>;
  openModelsFolder: () => Promise<IpcResult<void>>;
}

/**
 * Application API exposed to the renderer process.
 */
export interface AppApi {
  memory: {
    ask: (input: { question: string }) => Promise<IpcResult<AskResult>>;
    status: () => Promise<IpcResult<MemoryStatus>>;
    reindex: () => Promise<IpcResult<void>>;
    history: () => Promise<IpcResult<AskEntry[]>>;
    onAnswered: (callback: (entry: AskEntry) => void) => () => void;
  };
  system: {
    getLoginItem: () => Promise<IpcResult<LoginItemState>>;
    setLoginItem: (enabled: boolean) => Promise<IpcResult<LoginItemState>>;
  };
  asr: ASRApi;
  history: HistoryApi;
  settings: SettingsApi;
  whisperServer: WhisperServerApi;
  report: {
    get: (input: ReportInput) => Promise<IpcResult<SpeechReport>>;
    comment: (input: ReportInput) => Promise<IpcResult<{ text: string }>>;
  };
  polish: { getStatus: () => Promise<IpcResult<PolishInfo>> };
}

/** The floating renderer can only observe ASR and report its content height. */
export interface FloatingAppApi {
  asr: Pick<ASRApi, 'onStatus' | 'onResult' | 'onError'>;
  floatingWindow: FloatingWindowApi;
}

declare global {
  interface Window {
    api: AppApi;
  }
}

export {};
