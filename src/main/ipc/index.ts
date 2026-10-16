import { setupModelsHandlers } from './models.handler';
import { setupMemoryHandlers } from './memory.handler';
/**
 * IPC handler registration.
 * Central place to register all IPC handlers.
 */

import { setupReportHandlers } from './report.handler';
import { setupPermissionsHandlers } from './permissions.handler';
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
  setupPermissionsHandlers();
  setupPolishHandlers();
  setupReportHandlers();
  setupMemoryHandlers();
  setupFloatingWindowHandlers();
  setupHistoryHandlers();
  setupSettingsHandlers();
  setupWhisperServerHandlers();
  setupModelsHandlers();
}
