import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { app } from 'electron';
import log from 'electron-log';
import { settingsService } from '../settings';
import { whisperServerService } from '../whisper-server';
import { ModelDownloadService } from './model-download.service';
import { loadModelCatalog } from './catalog';

let service: ModelDownloadService | undefined;
/** Lazy paths/catalog: app userData and test overrides are ready before first IPC setup. */
export function getModelDownloadService(): ModelDownloadService {
  service ??= new ModelDownloadService({
    catalog: loadModelCatalog(app.isPackaged, process.env, file => readFileSync(file, 'utf8')),
    directories: { userData: () => app.getPath('userData'), homedir },
    logger: log.scope('model-download'),
    allowLoopback: !app.isPackaged && Boolean(process.env.WAAE_MODEL_CATALOG),
    selectedModel: () => {
      const result = settingsService.get();
      return result.success ? result.data.asr.model : null;
    },
    runningModel: () => {
      const status = whisperServerService.status();
      return status.state === 'ready' || status.state === 'starting' ? status.modelId : null;
    },
    clearSelectedModel: () => {
      const result = settingsService.update({ asr: { model: null } });
      if (!result.success) throw new Error('Failed to reset selected model');
    },
  });
  return service;
}

export function stopModelDownload(): void {
  void service?.cancel();
}
