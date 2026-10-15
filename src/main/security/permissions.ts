/** Default-deny permissions shared by permission requests and checks. */

import type { Session } from 'electron';
import log from 'electron-log';
import { getTrustedWindowRole, type WindowRole } from '../ipc/sender';

const logger = log.scope('permissions');

/** Pure policy: only the main window may record audio or write sanitized text. */
export function decidePermission(
  role: WindowRole | undefined,
  permission: string,
  mediaTypes?: readonly string[],
): boolean {
  if (role !== 'main') return false;
  if (permission === 'clipboard-sanitized-write') return true;
  return permission === 'media' && mediaTypes !== undefined && mediaTypes.length > 0 &&
    mediaTypes.every((type) => type === 'audio');
}

/** Pass session.defaultSession after app readiness; no Electron runtime import. */
export function installPermissionHandlers(session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const windowRole = getTrustedWindowRole(webContents);
    const role = windowRole && details.isMainFrame && details.requestingUrl === webContents.mainFrame.url
      ? windowRole : undefined;
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    const allowed = decidePermission(role, permission, mediaTypes);
    // A denied microphone means silent recordings, so make the reason visible in the log
    if (!allowed) logger.warn('Permission request denied', { permission, role: role ?? null, mediaTypes });
    callback(allowed);
  });
  session.setPermissionCheckHandler((webContents, permission, _requestingOrigin, details) => {
    const windowRole = getTrustedWindowRole(webContents);
    const role = windowRole && webContents && details.isMainFrame && details.requestingUrl === webContents.mainFrame.url
      ? windowRole : undefined;
    return decidePermission(role, permission, details.mediaType ? [details.mediaType] : undefined);
  });
}
