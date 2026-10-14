/**
 * History IPC handlers.
 * Connects IPC channels to history service and forwards changes to all windows.
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { HistoryChange, IpcResult, ListHistoryResult, TranscriptionItem } from '../../shared/types';
import { historyService } from '../services/history';
import { broadcastToAllWindows } from './asr.handler';
import { isTrustedSender } from './sender';

const logger = log.scope('history-handler');
let handlersRegistered = false;

/**
 * Setup history IPC handlers and forward service changes to renderer processes.
 * Repeated calls leave existing handlers and subscriptions in place.
 */
export function setupHistoryHandlers(): void {
  if (handlersRegistered) return;

  ipcMain.handle(IPC_CHANNELS.HISTORY.LIST, async (event, input: unknown): Promise<IpcResult<ListHistoryResult>> => {
    try {
      if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender' };
      return await historyService.list(input);
    } catch (error) {
      logger.error('Failed to list history', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY.GET, async (event, input: unknown): Promise<IpcResult<TranscriptionItem | null>> => {
    try {
      if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender' };
      return await historyService.get(input);
    } catch (error) {
      logger.error('Failed to get history', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY.DELETE, async (event, input: unknown): Promise<IpcResult<{ deleted: boolean }>> => {
    try {
      if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender' };
      return await historyService.delete(input);
    } catch (error) {
      logger.error('Failed to delete history', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY.CLEAR, async (event, input: unknown): Promise<IpcResult<{ deleted: number }>> => {
    try {
      if (!isTrustedSender(event)) return { success: false, error: 'Untrusted sender' };
      return await historyService.clear(input);
    } catch (error) {
      logger.error('Failed to clear history', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  historyService.on('changed', (change: HistoryChange) => {
    broadcastToAllWindows(IPC_CHANNELS.HISTORY.CHANGED, change);
  });

  handlersRegistered = true;
  logger.info('History IPC handlers and event forwarding configured');
}
