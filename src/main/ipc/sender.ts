/**
 * Sender validation for history and settings IPC requests.
 */

/**
 * Trust packaged file pages and configured Vite development server pages.
 */
export function isTrustedSender(event: Electron.IpcMainInvokeEvent): boolean {
  if (!event.senderFrame) return false;

  const url = event.senderFrame.url;
  return url.startsWith('file://') ||
    (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' &&
      MAIN_WINDOW_VITE_DEV_SERVER_URL.length > 0 &&
      url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL)) ||
    (typeof FLOATING_WINDOW_VITE_DEV_SERVER_URL === 'string' &&
      FLOATING_WINDOW_VITE_DEV_SERVER_URL.length > 0 &&
      url.startsWith(FLOATING_WINDOW_VITE_DEV_SERVER_URL));
}
