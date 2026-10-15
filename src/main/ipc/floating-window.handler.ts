/**
 * Floating Window IPC handlers.
 * Handles content height updates from the floating renderer.
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { floatingWindow } from '../windows';
import { isTrustedSender } from './sender';
import { validateContentHeight } from './content-height';

/**
 * Setup floating window IPC handlers.
 */
export function setupFloatingWindowHandlers(): void {
  // Handle content height update for adaptive window sizing
  // Use ipcMain.on (not handle) since this is a fire-and-forget message
  ipcMain.on(IPC_CHANNELS.FLOATING_WINDOW.SET_CONTENT_HEIGHT, (event, height: unknown) => {
    if (!isTrustedSender(event, 'floating')) return;
    const contentHeight = validateContentHeight(height);
    if (contentHeight === null) return;
    floatingWindow.setContentHeight(contentHeight);
  });
}
