/**
 * IPC handler registration.
 * Central place to register all IPC handlers.
 */

import { setupSystemHandlers } from './system.handler';
import { setupPolishHandlers } from './polish.handler';
import { setupASRHandlers } from './asr.handler';
import { setupFloatingWindowHandlers } from './floating-window.handler';
import { setupHistoryHandlers } from './history.handler';
import { setupSettingsHandlers } from './settings.handler';
import { setupWhisperServerHandlers } from './whisper-server.handler';

/**
 * Setup all IPC handlers.
 * Call this during app initialization, before creating windows.
 */
export function setupAllIpcHandlers(): void {
  setupASRHandlers();
  setupSystemHandlers();
  setupPolishHandlers();
  setupFloatingWindowHandlers();
  setupHistoryHandlers();
  setupSettingsHandlers();
  setupWhisperServerHandlers();
}
