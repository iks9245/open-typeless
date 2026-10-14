import 'dotenv/config';
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import log from 'electron-log';
import { setupAllIpcHandlers } from './main/ipc';
import { floatingWindow } from './main/windows';
import { pushToTalkService } from './main/services';
import { closeDatabase, initDatabase } from './main/db';
import { historyService } from './main/services/history';

const logger = log.scope('main');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Setup IPC handlers before app is ready
setupAllIpcHandlers();

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Block navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigins = [
      MAIN_WINDOW_VITE_DEV_SERVER_URL,
      'file://',
    ].filter((origin): origin is string => Boolean(origin));
    const isAllowed = allowedOrigins.some((origin) => url.startsWith(origin));
    if (!isAllowed) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Open DevTools in development only
  if (process.env.NODE_ENV !== 'production') {
    mainWindow.webContents.openDevTools();
  }

  // Create the floating window (hidden initially)
  floatingWindow.create();

  // Initialize push-to-talk service after windows are created
  pushToTalkService.initialize();
};

/**
 * Open local storage and maintain history once per launch.
 * Failure only disables history/settings persistence; dictation keeps working.
 */
const initStorage = (): void => {
  if (!initDatabase()) {
    return;
  }

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
  initStorage();
  createWindow();
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
  pushToTalkService.dispose();
  floatingWindow.destroy();
  // Idempotent; an unfinished session is marked interrupted on next launch
  closeDatabase();
}

// Clean up before quitting
app.on('before-quit', cleanup);

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
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
