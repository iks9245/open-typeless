/**
 * IPC handler registration.
 * Central place to register all IPC handlers.
 */

import { setupASRHandlers } from './asr.handler';
import { setupFloatingWindowHandlers } from './floating-window.handler';
import { setupHistoryHandlers } from './history.handler';
import { setupSettingsHandlers } from './settings.handler';

/**
 * Setup all IPC handlers.
 * Call this during app initialization, before creating windows.
 */
export function setupAllIpcHandlers(): void {
  setupASRHandlers();
  setupFloatingWindowHandlers();
  setupHistoryHandlers();
  setupSettingsHandlers();
}
