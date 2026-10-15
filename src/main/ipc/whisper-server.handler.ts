/**
 * whisper-server IPC handler.
 * Exposes a read-only, renderer-safe view of the local whisper.cpp server status.
 */

import path from 'node:path';
import { ipcMain, shell } from 'electron';
import log from 'electron-log';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import type { IpcResult, WhisperModelInfo, WhisperServerInfo } from '../../shared/types';
import { ensureModelsFolder, listWhisperModels, whisperServerService, type WhisperServerStatus } from '../services/whisper-server';
import { isTrustedSender } from './sender';

const logger = log.scope('whisper-server-handler');
let handlersRegistered = false;

const fileName = (file: string | null): string | null => (file === null ? null : path.basename(file));

/**
 * Map the service status to what the renderer may see: no paths or process IDs.
 */
export function toWhisperServerInfo(status: WhisperServerStatus): WhisperServerInfo {
  return {
    mode: status.mode,
    state: status.state,
    reason: status.reason,
    binaryName: fileName(status.binary),
    modelName: fileName(status.model),
    vadModelName: fileName(status.vadModel),
    modelId: status.modelId,
    modelFallback: status.modelFallback,
    modelLocked: status.modelLocked,
  };
}

/**
 * Setup whisper-server IPC handlers. Repeated calls are ignored.
 */
export function setupWhisperServerHandlers(): void {
  if (handlersRegistered) return;

  ipcMain.handle(IPC_CHANNELS.WHISPER_SERVER.STATUS, (event): IpcResult<WhisperServerInfo> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      return { success: true, data: toWhisperServerInfo(whisperServerService.status()) };
    } catch (error) {
      logger.error('Failed to read whisper-server status', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WHISPER_SERVER.MODELS, (event): IpcResult<WhisperModelInfo[]> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      return { success: true, data: listWhisperModels() };
    } catch (error) {
      logger.error('Failed to list whisper models', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  ipcMain.handle(IPC_CHANNELS.WHISPER_SERVER.OPEN_MODELS_FOLDER, async (event): Promise<IpcResult<void>> => {
    try {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      const error = await shell.openPath(ensureModelsFolder());
      if (error) {
        logger.warn('Failed to open models folder', { error });
        return { success: false, error: '無法打開模型資料夾' };
      }
      return { success: true, data: undefined };
    } catch (error) {
      logger.error('Failed to open models folder', { error });
      return { success: false, error: 'Internal error' };
    }
  });

  handlersRegistered = true;
}
