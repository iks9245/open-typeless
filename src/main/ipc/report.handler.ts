import { ipcMain } from 'electron';
import log from 'electron-log';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { IpcResult } from '../../shared/types/common';
import type { SpeechReport } from '../../shared/types/report';
import { reportService } from '../services/report';
import { isTrustedSender } from './sender';

const logger = log.scope('report-handler');
let handlersRegistered = false;

export function setupReportHandlers(): void {
  if (handlersRegistered) return;
  ipcMain.handle(IPC_CHANNELS.REPORT.GET, (event, input: unknown): IpcResult<SpeechReport> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      return reportService.build(input);
    } catch {
      logger.error('Failed to get speech report');
      return { success: false, error: 'Internal error' };
    }
  });
  ipcMain.handle(IPC_CHANNELS.REPORT.COMMENT, async (event, input: unknown): Promise<IpcResult<{ text: string }>> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      const result = await reportService.comment(input);
      return 'error' in result ? { success: false, error: result.error } : { success: true, data: result };
    } catch {
      logger.error('Failed to comment on speech report');
      return { success: false, error: 'Internal error' };
    }
  });
  handlersRegistered = true;
}
