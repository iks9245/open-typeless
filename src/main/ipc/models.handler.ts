import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { IpcResult } from '../../shared/types/common';
import type { ModelDownloadProgress } from '../../shared/types/model-download';
import { modelKeySchema } from '../services/model-download/catalog';
import { ModelDownloadError } from '../services/model-download/model-download.service';
import { getModelDownloadService } from '../services/model-download';
import { WHISPER_MODEL_ID_PATTERN } from '../services/whisper-server/lib/models';
import { isTrustedSender, getTrustedWindowRole } from './sender';

let handlersRegistered = false;

export function setupModelsHandlers(): void {
  if (handlersRegistered) return;
  const service = getModelDownloadService();
  const key = (input: unknown) => modelKeySchema.parse(input);
  const modelId = z.string().regex(WHISPER_MODEL_ID_PATTERN);
  const operations: [string, (input: unknown) => unknown][] = [
    [IPC_CHANNELS.MODELS.CATALOG, () => service.catalog()],
    [IPC_CHANNELS.MODELS.DOWNLOAD_START, input => service.start(key(input))],
    [IPC_CHANNELS.MODELS.DOWNLOAD_CANCEL, () => service.cancel()],
    [IPC_CHANNELS.MODELS.DOWNLOAD_DISCARD, input => service.discard(key(input))],
    [IPC_CHANNELS.MODELS.DELETE, input => service.delete(modelId.parse(input))],
  ];
  for (const [channel, operation] of operations) {
    ipcMain.handle(channel, async (event, input: unknown): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      try { return { success: true, data: await operation(input) }; }
      catch (error) {
        // Only service-authored errors are public; Zod/OS errors may contain input or paths.
        return { success: false, error: error instanceof ModelDownloadError ? error.message : '無法處理模型操作' };
      }
    });
  }
  service.on('progress', (progress: ModelDownloadProgress) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && getTrustedWindowRole(window.webContents) === 'main') {
        // Closing a window must not turn a successful transfer into a download failure.
        try { window.webContents.send(IPC_CHANNELS.MODELS.DOWNLOAD_PROGRESS, progress); } catch { /* Window closed. */ }
      }
    }
  });
  handlersRegistered = true;
}
