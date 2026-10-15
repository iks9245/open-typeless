/**
 * Window registration, navigation boundaries and IPC sender validation.
 * Register before loading the renderer so its first main-frame URL is pinned.
 */

import type { Event, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';

export type WindowRole = 'main' | 'floating';

interface TrustedWindow {
  role: WindowRole;
  url: string | null;
}

const trustedWindows = new WeakMap<WebContents, TrustedWindow>();
const roleContents = new Map<WindowRole, WebContents>();

/** Recording commands go only to the registered renderer for this role. */
export function getTrustedWebContents(role: WindowRole): WebContents | null {
  const contents = roleContents.get(role);
  return contents && getTrustedWindowRole(contents) === role ? contents : null;
}

export function registerTrustedWindow(webContents: WebContents, role: WindowRole): void {
  if (webContents.isDestroyed() || trustedWindows.has(webContents)) return;

  const currentUrl = webContents.getURL();
  const registration: TrustedWindow = {
    role,
    url: currentUrl && currentUrl !== 'about:blank' ? currentUrl : null,
  };
  trustedWindows.set(webContents, registration);
  roleContents.set(role, webContents);

  // did-start-navigation runs before preload/renderer IPC, including on loadFile.
  // Never update this URL on subsequent navigation or redirects.
  const pinUrl = (_event: Event, url: string, _isInPlace: boolean, isMainFrame: boolean): void => {
    if (!isMainFrame || registration.url !== null) return;
    registration.url = url;
    webContents.removeListener('did-start-navigation', pinUrl);
  };
  if (registration.url === null) webContents.on('did-start-navigation', pinUrl);

  const restrictNavigation = (event: Event, url: string): void => {
    if (url !== registration.url) event.preventDefault();
  };
  webContents.on('will-navigate', restrictNavigation);
  webContents.on('will-redirect', restrictNavigation);
  webContents.once('destroyed', () => {
    trustedWindows.delete(webContents);
    if (roleContents.get(role) === webContents) roleContents.delete(role);
  });
}

/** Only a registered window still showing its original page has a trusted role. */
export function getTrustedWindowRole(webContents: WebContents | null): WindowRole | undefined {
  if (!webContents || webContents.isDestroyed()) return undefined;
  const registration = trustedWindows.get(webContents);
  if (!registration?.url || webContents.mainFrame.url !== registration.url) return undefined;
  return registration.role;
}

export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent, role: WindowRole): boolean {
  return getTrustedWindowRole(event.sender) === role &&
    event.senderFrame === event.sender.mainFrame;
}
