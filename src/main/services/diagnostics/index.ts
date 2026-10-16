import { readFile, statfs } from 'node:fs/promises';
import { cpus, homedir, release, tmpdir, totalmem, userInfo } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { getDb, isDatabaseAvailable } from '../../db';
import { settingsService } from '../settings';
import { whisperServerService } from '../whisper-server';
import { permissionsService } from '../permissions';
import { polishService } from '../polish';
import { readOmlxConfig } from '../polish/lib/omlx-config';
import { getModelDownloadService } from '../model-download';
import { memoryIndexer } from '../memory';
import { toWhisperServerInfo } from '../../ipc/whisper-server.handler';
import { DiagnosticsService } from './diagnostics.service';

export const diagnosticsService = new DiagnosticsService({
  summary: async () => {
    const stamp = app.isPackaged ? path.join(process.resourcesPath, 'whisper-server.version')
      : path.join(app.getAppPath(), 'resources', 'bin', 'whisper-server.version');
    let whisperCpp: string | null = null;
    try { whisperCpp = (await readFile(stamp, 'utf8')).trim() || null; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let freeDiskGb: number | null = null;
    try { const disk = await statfs(app.getPath('userData')); freeDiskGb = disk.bavail * disk.bsize / 1024 ** 3; }
    catch { /* Storage may be unavailable; the remaining diagnostics still help. */ }
    return {
      app: { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, packaged: app.isPackaged, whisperCpp },
      system: { release: release(), version: process.getSystemVersion(), cpu: cpus()[0]?.model ?? 'Unknown', totalMemoryGb: totalmem() / 1024 ** 3, freeDiskGb, locale: app.getLocale() },
    };
  },
  settings: () => {
    const result = settingsService.get();
    if (!result.success) throw new Error('Settings unavailable');
    return result.data;
  },
  db: () => isDatabaseAvailable() ? getDb() : null,
  whisperServer: () => toWhisperServerInfo(whisperServerService.status()),
  permissions: () => permissionsService.checkPermissions(),
  polish: () => polishService.status(),
  models: () => getModelDownloadService().catalog(),
  memory: () => memoryIndexer.status(),
  secrets: async () => {
    const config = await readOmlxConfig({ readFile: file => readFile(file, 'utf8'), env: process.env, homedir, logger: log.scope('diagnostics') });
    return [config?.apiKey, ...Object.entries(process.env).filter(([key]) => /(?:^|_)(?:API_KEY|ACCESS_KEY|ACCESS_TOKEN|TOKEN|SECRET|PASSWORD)$/i.test(key)).map(([, value]) => value)]
      .filter((value): value is string => Boolean(value));
  },
  home: homedir, username: () => userInfo().username, tempDirectory: tmpdir,
  logFile: () => log.transports.file.getFile().path,
});
