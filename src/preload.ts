/**
 * Preload script for Electron.
 * Exposes a safe API to the renderer process via contextBridge.
 *
 * See the Electron documentation for details on how to use preload scripts:
 * https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/constants/channels';
import type { ASRConfig, ASRResult, ASRStatus } from './shared/types/asr';
import type { IpcResult } from './shared/types/common';
import type { HistoryChange, ListHistoryInput, ListHistoryResult, TranscriptionItem } from './shared/types/history';
import type { AppSettings, AppSettingsPatch } from './shared/types/settings';

/**
 * ASR API exposed to the renderer process.
 */
const asrApi = {
  /**
   * Start ASR session.
   * @param config - Optional partial ASR configuration
   */
  start: (config?: Partial<ASRConfig>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ASR.START, config),

  /**
   * Stop ASR session.
   */
  stop: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ASR.STOP),

  /**
   * Send audio chunk to main process.
   * @param chunk - Audio data as ArrayBuffer
   */
  sendAudio: (chunk: ArrayBuffer): void => {
    ipcRenderer.send(IPC_CHANNELS.ASR.SEND_AUDIO, chunk);
  },

  /**
   * Subscribe to ASR results.
   * @param callback - Called when ASR result is received
   * @returns Unsubscribe function
   */
  onResult: (callback: (result: ASRResult) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: ASRResult): void => {
      callback(result);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.RESULT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.RESULT, handler);
    };
  },

  /**
   * Subscribe to ASR status changes.
   * @param callback - Called when ASR status changes
   * @returns Unsubscribe function
   */
  onStatus: (callback: (status: ASRStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ASRStatus): void => {
      callback(status);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.STATUS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.STATUS, handler);
    };
  },

  /**
   * Subscribe to ASR errors.
   * @param callback - Called when ASR error occurs
   * @returns Unsubscribe function
   */
  onError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void => {
      callback(error);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.ERROR, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.ERROR, handler);
    };
  },
};

/**
 * Floating Window API exposed to the renderer process.
 */
const floatingWindowApi = {
  /**
   * Show the floating window.
   */
  show: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOATING_WINDOW.SHOW),

  /**
   * Hide the floating window.
   */
  hide: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOATING_WINDOW.HIDE),

  /**
   * Set content height for adaptive window sizing.
   * @param height - Content height in pixels (from scrollHeight)
   */
  setContentHeight: (height: number): void => {
    ipcRenderer.send(IPC_CHANNELS.FLOATING_WINDOW.SET_CONTENT_HEIGHT, height);
  },
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

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('api', {
  asr: asrApi,
  floatingWindow: floatingWindowApi,
  history: historyApi,
  settings: settingsApi,
});
