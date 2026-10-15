import { EventEmitter } from 'node:events';
import type { IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron';

/** A minimal Electron-shaped object; these tests run in plain Node. */
export function mockWebContents(url = '') {
  const events = new EventEmitter();
  const mainFrame = { url };
  const webContents = {
    mainFrame,
    getURL: () => mainFrame.url,
    isDestroyed: () => false,
    on: events.on.bind(events),
    once: events.once.bind(events),
    removeListener: events.removeListener.bind(events),
  } as unknown as WebContents;
  return { webContents, mainFrame, events };
}

export function mockIpcEvent(sender: WebContents, senderFrame: WebFrameMain | null = sender.mainFrame): IpcMainInvokeEvent {
  return { sender, senderFrame } as IpcMainInvokeEvent;
}
