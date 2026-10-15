import { ipcMain } from 'electron';
import log from 'electron-log';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { IpcResult } from '../../shared/types/common';
import type { LoginItemState } from '../../shared/types/system';
import { loginItemService } from '../services/login-item';
import { isTrustedSender } from './sender';

const logger = log.scope('system-handler');
const enabledSchema = z.boolean();
let handlersRegistered = false;

export function setupSystemHandlers(): void {
  if (handlersRegistered) return;
  ipcMain.handle(IPC_CHANNELS.SYSTEM.GET_LOGIN_ITEM, (event): IpcResult<LoginItemState> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      return { success: true, data: loginItemService.get() };
    } catch (error) {
      logger.error('Failed to read login item', { error });
      return { success: false, error: 'Internal error' };
    }
  });
  ipcMain.handle(IPC_CHANNELS.SYSTEM.SET_LOGIN_ITEM, (event, input: unknown): IpcResult<LoginItemState> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      const parsed = enabledSchema.safeParse(input);
      if (parsed.success === false) return { success: false, error: parsed.error.issues[0].message };
      return { success: true, data: loginItemService.set(parsed.data) };
    } catch (error) {
      logger.error('Failed to set login item', { error });
      return { success: false, error: 'Internal error' };
    }
  });
  handlersRegistered = true;
}
