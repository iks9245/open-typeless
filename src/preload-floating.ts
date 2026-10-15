/** Minimal bridge for the sandboxed floating renderer. */

import { contextBridge, ipcRenderer } from 'electron';
import { asrEvents } from './preload-asr';
import { IPC_CHANNELS } from './shared/constants/channels';
import type { FloatingAppApi } from './types/global';

contextBridge.exposeInMainWorld('api', {
  asr: asrEvents,
  floatingWindow: {
    setContentHeight: (height: number): void => {
      ipcRenderer.send(IPC_CHANNELS.FLOATING_WINDOW.SET_CONTENT_HEIGHT, height);
    },
  },
} satisfies FloatingAppApi);
