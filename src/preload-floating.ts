/** Minimal bridge for the sandboxed floating renderer. */

import { contextBridge, ipcRenderer } from 'electron';
import { asrEvents } from './preload-asr';
import { IPC_CHANNELS } from './shared/constants/channels';
import type { InputMode } from './shared/constants/command';
import type { FloatingAppApi } from './types/global';

contextBridge.exposeInMainWorld('api', {
  asr: asrEvents,
  floatingWindow: {
    onMode: (callback: (mode: InputMode) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, mode: InputMode): void => { callback(mode); };
      ipcRenderer.on(IPC_CHANNELS.FLOATING_WINDOW.MODE, handler);
      return () => { ipcRenderer.removeListener(IPC_CHANNELS.FLOATING_WINDOW.MODE, handler); };
    },
    setContentHeight: (height: number): void => {
      ipcRenderer.send(IPC_CHANNELS.FLOATING_WINDOW.SET_CONTENT_HEIGHT, height);
    },
  },
} satisfies FloatingAppApi);
