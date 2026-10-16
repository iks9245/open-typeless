import { forwardConsoleErrors } from './console';
/** The main renderer records audio even while its window is hidden. */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerTrustedWindow } from '../ipc/sender';

export function hideOnClose(window: BrowserWindow, isQuitting: () => boolean): void {
  window.on('close', (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
}

export function createWindow(isQuitting: () => boolean, show = true): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    show,
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: 'WaaE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  registerTrustedWindow(mainWindow.webContents, 'main');
  forwardConsoleErrors(mainWindow.webContents, 'main');
  hideOnClose(mainWindow, isQuitting);

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open DevTools in development only
  if (!app.isPackaged && process.env.OPEN_DEVTOOLS !== '0') {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}
