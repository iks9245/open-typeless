import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants/channels';
import { FEEDBACK_URL } from '../../shared/constants/support';
import type { IpcResult } from '../../shared/types/common';
import type { DiagnosticsExportResult } from '../../shared/types/diagnostics';
import { diagnosticsService } from '../services/diagnostics';
import { isTrustedSender } from './sender';

let handlersRegistered = false;

export function diagnosticsFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `waae-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
}

export interface DiagnosticsHandlerDependencies {
  service: Pick<typeof diagnosticsService, 'summary' | 'export'>;
  /** Tests inject the dialog result here; renderer input never supplies an output path. */
  savePath: (window: BrowserWindow, defaultPath: string) => Promise<string | null>;
}

const defaults: DiagnosticsHandlerDependencies = {
  service: diagnosticsService,
  savePath: async (window, defaultPath) => {
    const result = await dialog.showSaveDialog(window, { title: '匯出診斷資料', defaultPath, filters: [{ name: 'ZIP 壓縮檔', extensions: ['zip'] }] });
    return result.canceled ? null : result.filePath ?? null;
  },
};

export function setupDiagnosticsHandlers(deps: DiagnosticsHandlerDependencies = defaults): void {
  if (handlersRegistered) return;
  let lastExport: string | null = null;
  let exporting = false;
  const operations: [string, (window: BrowserWindow) => unknown][] = [
    [IPC_CHANNELS.DIAGNOSTICS.SUMMARY, () => deps.service.summary()],
    [IPC_CHANNELS.DIAGNOSTICS.EXPORT, async (window): Promise<DiagnosticsExportResult> => {
      if (exporting) throw new Error('Export in progress');
      exporting = true;
      try {
        const target = await deps.savePath(window, path.join(app.getPath('desktop'), diagnosticsFileName(new Date())));
        if (!target) return { saved: false, fileName: null };
        const saved = await deps.service.export(target);
        lastExport = saved;
        return { saved: true, fileName: path.basename(saved) };
      } finally { exporting = false; }
    }],
    [IPC_CHANNELS.DIAGNOSTICS.REVEAL, () => { if (lastExport) shell.showItemInFolder(lastExport); }],
    [IPC_CHANNELS.DIAGNOSTICS.FEEDBACK, async () => { if (FEEDBACK_URL) await shell.openExternal(FEEDBACK_URL); }],
  ];
  for (const [channel, operation] of operations) {
    ipcMain.handle(channel, async (event): Promise<IpcResult<unknown>> => {
      if (!isTrustedSender(event, 'main')) return { success: false, error: 'Untrusted sender' };
      try {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed()) throw new Error('Window unavailable');
        return { success: true, data: await operation(window) };
      } catch {
        // Filesystem errors may contain local paths; only a fixed message crosses IPC.
        return { success: false, error: '無法處理診斷資料，請再試一次。' };
      }
    });
  }
  handlersRegistered = true;
}
