/** Read-only oMLX status. No configuration or secrets cross IPC. */
import { ipcMain } from 'electron';
import log from 'electron-log';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { IpcResult, PolishInfo } from '../../shared/types';
import { polishService } from '../services/polish';
import { isTrustedSender } from './sender';

const logger = log.scope('polish-handler');
let handlersRegistered = false;

export function setupPolishHandlers(): void {
  if (handlersRegistered) return;
  ipcMain.handle(IPC_CHANNELS.POLISH.STATUS, async (event): Promise<IpcResult<PolishInfo>> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      return { success: true, data: await polishService.status() };
    } catch {
      logger.error('Failed to read oMLX status');
      return { success: false, error: 'Internal error' };
    }
  });
  handlersRegistered = true;
}
