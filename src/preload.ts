import type { AskEntry } from './shared/types/memory';
/**
 * Preload script for Electron.
 * Exposes a safe API to the renderer process via contextBridge.
 *
 * See the Electron documentation for details on how to use preload scripts:
 * https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/constants/channels';
import { asrEvents } from './preload-asr';
import type { LoginItemState } from './shared/types/system';
import type { ReportInput, SpeechReport } from './shared/types/report';
import type { AppApi } from './types/global';
import type { PolishInfo } from './shared/types/polish';
import type { IpcResult } from './shared/types/common';
import type { HistoryChange, ListHistoryInput, ListHistoryResult, TranscriptionItem } from './shared/types/history';
import type { AppSettings, AppSettingsPatch } from './shared/types/settings';
import type { WhisperServerInfo } from './shared/types/whisper-server';

/**
 * ASR API exposed to the renderer process.
 */
const asrApi = {
  /**
   * Send audio chunk to main process.
   * @param chunk - Audio data as ArrayBuffer
   */
  sendAudio: (chunk: ArrayBuffer): void => {
    ipcRenderer.send(IPC_CHANNELS.ASR.SEND_AUDIO, chunk);
  },

  ...asrEvents,
};

/**
 * History API exposed to the renderer process.
 */
const historyApi = {
  /**
   * List transcription history.
   * @param input - Optional pagination and filters
   */
  list: (input?: ListHistoryInput): Promise<IpcResult<ListHistoryResult>> =>
    ipcRenderer.invoke(IPC_CHANNELS.HISTORY.LIST, input),

  /**
   * Get a transcription by ID.
   * @param id - Transcription ID
   */
  get: (id: string): Promise<IpcResult<TranscriptionItem | null>> =>
    ipcRenderer.invoke(IPC_CHANNELS.HISTORY.GET, { id }),

  /**
   * Delete a transcription and its saved audio.
   * @param id - Transcription ID
   */
  delete: (id: string): Promise<IpcResult<{ deleted: boolean }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.HISTORY.DELETE, { id }),

  /**
   * Clear transcription history and saved audio.
   */
  clear: (): Promise<IpcResult<{ deleted: number }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.HISTORY.CLEAR, {}),

  /**
   * Subscribe to history changes.
   * @param callback - Called when history changes
   * @returns Unsubscribe function
   */
  onChanged: (callback: (change: HistoryChange) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, change: HistoryChange): void => {
      callback(change);
    };
    ipcRenderer.on(IPC_CHANNELS.HISTORY.CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.HISTORY.CHANGED, handler);
    };
  },
};

/**
 * Settings API exposed to the renderer process.
 */
const settingsApi = {
  /**
   * Get application settings, including defaults.
   */
  get: (): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.GET, {}),

  /**
   * Update application settings.
   * @param patch - Partial settings to update
   */
  update: (patch: AppSettingsPatch): Promise<IpcResult<AppSettings>> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS.UPDATE, patch),

  /**
   * Subscribe to settings changes.
   * @param callback - Called with the complete updated settings
   * @returns Unsubscribe function
   */
  onChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings): void => {
      callback(settings);
    };
    ipcRenderer.on(IPC_CHANNELS.SETTINGS.CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SETTINGS.CHANGED, handler);
    };
  },
};

/**
 * whisper.cpp server API exposed to the renderer process.
 */
const whisperServerApi = {
  /**
   * Read the local whisper.cpp server status (file names only, no paths).
   */
  getStatus: (): Promise<IpcResult<WhisperServerInfo>> =>
    ipcRenderer.invoke(IPC_CHANNELS.WHISPER_SERVER.STATUS),
};

const polishApi = {
  /** Read local oMLX availability and installed model IDs. */
  getStatus: (): Promise<IpcResult<PolishInfo>> =>
    ipcRenderer.invoke(IPC_CHANNELS.POLISH.STATUS),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('api', {
  system: {
    getLoginItem: (): Promise<IpcResult<LoginItemState>> => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.GET_LOGIN_ITEM),
    setLoginItem: (enabled: boolean): Promise<IpcResult<LoginItemState>> => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM.SET_LOGIN_ITEM, enabled),
  },
  memory: {
    ask: input => ipcRenderer.invoke(IPC_CHANNELS.MEMORY.ASK, input),
    status: () => ipcRenderer.invoke(IPC_CHANNELS.MEMORY.STATUS),
    reindex: () => ipcRenderer.invoke(IPC_CHANNELS.MEMORY.REINDEX),
    history: () => ipcRenderer.invoke(IPC_CHANNELS.MEMORY.HISTORY),
    onAnswered: callback => {
      const handler = (_event: Electron.IpcRendererEvent, entry: AskEntry): void => { callback(entry); };
      ipcRenderer.on(IPC_CHANNELS.MEMORY.ANSWERED, handler);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.MEMORY.ANSWERED, handler); };
    },
  },
  asr: asrApi,
  history: historyApi,
  settings: settingsApi,
  whisperServer: whisperServerApi,
  polish: polishApi,
  report: {
    get: (input: ReportInput): Promise<IpcResult<SpeechReport>> => ipcRenderer.invoke(IPC_CHANNELS.REPORT.GET, input),
    comment: (input: ReportInput): Promise<IpcResult<{ text: string }>> => ipcRenderer.invoke(IPC_CHANNELS.REPORT.COMMENT, input),
  },
} satisfies AppApi);
