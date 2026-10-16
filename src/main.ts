import { stopModelDownload } from './main/services/model-download';
import 'dotenv/config';
import { memoryIndexer } from './main/services/memory';
import { app, session } from 'electron';
import type { BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import log from 'electron-log';
import { setupAllIpcHandlers } from './main/ipc';
import { createWindow } from './main/windows/main-window';
import { loginItemService } from './main/services/login-item';
import { installPermissionHandlers } from './main/security/permissions';
import { floatingWindow } from './main/windows';
import { pushToTalkService } from './main/services';
import { migrateExistingUser } from './main/services/onboarding';
import { settingsService } from './main/services/settings';
import { closeDatabase, getDb, initDatabase } from './main/db';
import { historyService } from './main/services/history';
import { polishService } from './main/services/polish';
import { whisperServerService } from './main/services/whisper-server';

const logger = log.scope('main');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Apply to every web contents, including windows created outside our managers.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// Setup IPC handlers before app is ready
setupAllIpcHandlers();

let isQuitting = false;
let mainWindow: BrowserWindow | null = null;

/**
 * Open local storage and maintain history once per launch.
 * Failure only disables history/settings persistence; dictation keeps working.
 */
const initStorage = (): void => {
  if (!initDatabase()) {
    return;
  }

  migrateExistingUser(getDb());

  // Sessions cut off by a crash or forced quit become failed/interrupted
  const recovered = historyService.recover();
  if (recovered > 0) {
    logger.info('Recovered interrupted history sessions', { count: recovered });
  }

  // Apply the retention setting; runs in the background and never throws
  void historyService.prune().then((pruned) => {
    if (pruned > 0) {
      logger.info('Pruned history beyond retention', { count: pruned });
    }
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
// Storage is initialized once here, not in createWindow (which also runs on 'activate').
app.on('ready', () => {
  installPermissionHandlers(session.defaultSession);
  initStorage();
  memoryIndexer.start();
  // Start (or find) the local whisper.cpp server in the background; it reads its URL from
  // settings, so storage comes first. Never rejects; failures are logged.
  void whisperServerService.start();
  polishService.startWarmups();
  const settings = settingsService.get();
  const needsOnboarding = settings.success === false || !settings.data.onboarding.completed;
  mainWindow = createWindow(() => isQuitting, needsOnboarding || !loginItemService.wasOpenedAtLogin());
  floatingWindow.create();
  pushToTalkService.initialize();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Cleanup function for graceful shutdown
function cleanup(): void {
  memoryIndexer.stop();
  pushToTalkService.dispose();
  polishService.dispose();
  floatingWindow.destroy();
  // Sends SIGTERM synchronously, only to a server this app started or adopted
  stopModelDownload();
  void whisperServerService.stop();
  // Idempotent; an unfinished session is marked interrupted on next launch
  closeDatabase();
}

// Clean up before quitting
app.on('before-quit', () => {
  isQuitting = true;
  cleanup();
});

// Handle SIGINT (Ctrl+C) and SIGTERM for graceful shutdown
process.on('SIGINT', () => {
  cleanup();
  app.quit();
});

process.on('SIGTERM', () => {
  cleanup();
  app.quit();
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(() => isQuitting);
  } else {
    mainWindow.show();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
