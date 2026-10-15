/** ASR event subscriptions shared by the two isolated preloads. */

import { ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/constants/channels';
import type { ASRResult, ASRStatus } from './shared/types/asr';

export const asrEvents = {
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
