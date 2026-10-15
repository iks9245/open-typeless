/**
 * Settings IPC handlers.
 * Connects IPC channels to settings service and forwards changes to all windows.
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { AppSettings, IpcResult } from '../../shared/types';
import { settingsService } from '../services/settings';
import { broadcastToAllWindows } from './asr.handler';
import { isTrustedSender } from './sender';

const logger = log.scope('settings-handler');
let handlersRegistered = false;

/**
 * Setup settings IPC handlers and forward service changes to renderer processes.
 * Repeated calls leave existing handlers and subscriptions in place.
 */
export function setupSettingsHandlers(): void {
  if (handlersRegistered) return;

  ipcMain.handle(IPC_CHANNELS.SETTINGS.GET, async (event, input: unknown): Promise<IpcResult<AppSettings>> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      return await settingsService.get(input);
    } catch (error) {
      logger.error('Failed to get settings', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS.UPDATE, async (event, patch: unknown): Promise<IpcResult<AppSettings>> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      return await settingsService.update(patch);
    } catch (error) {
      logger.error('Failed to update settings', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  settingsService.on('changed', (settings: AppSettings) => {
    broadcastToAllWindows(IPC_CHANNELS.SETTINGS.CHANGED, settings);
  });

  handlersRegistered = true;
  logger.info('Settings IPC handlers and event forwarding configured');
}
