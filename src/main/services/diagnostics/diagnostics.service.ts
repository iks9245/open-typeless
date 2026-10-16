import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, open, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AppDatabase } from '../../db/client';
import type { DiagnosticsSummary } from '../../../shared/types/diagnostics';
import type { AppSettings } from '../../../shared/types/settings';
import type { WhisperServerInfo } from '../../../shared/types/whisper-server';
import type { PermissionsStatus } from '../../../shared/types/system';
import type { PolishInfo } from '../../../shared/types/polish';
import type { ModelCatalogState } from '../../../shared/types/model-download';
import type { MemoryStatus } from '../../../shared/types/memory';
import { collectHistory, historyPrivateValues } from './history';
import { createRedactor, redactJson } from './redact';

export const LOG_TAIL_BYTES = 2 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const README = `WaaE 診斷資料\n\n包含：app 與系統版本、設定（詞彙表僅含數量）、伺服器與權限狀態、\noMLX 可用狀態與模型數量、模型安裝狀態、記憶索引狀態、歷史分類統計、\n最近 50 次聽寫的時間、狀態、耗時與錯誤資訊，以及每份最多最後 2 MB 的記錄檔。\n\n不包含：任何聽寫文字、錄音、錄音路徑、詞彙表內容、歷史紀錄識別碼、\n歷史中繼資料或 API 金鑰。家目錄及路徑中的使用者名稱已遮蔽。\n資料只儲存在你選擇的位置，不會自動上傳。\n`;

export interface DiagnosticsDependencies {
  summary: () => Promise<DiagnosticsSummary>;
  settings: () => AppSettings;
  db: () => AppDatabase | null;
  whisperServer: () => WhisperServerInfo;
  permissions: () => PermissionsStatus;
  polish: () => Promise<PolishInfo>;
  models: () => Promise<ModelCatalogState[]>;
  memory: () => MemoryStatus;
  /** Additional known secrets, retained in main only. */
  secrets: () => Promise<string[]>;
  home: () => string;
  username: () => string;
  tempDirectory: () => string;
  logFile: () => string;
  zip?: (directory: string, target: string) => Promise<void>;
}

/** Read only the tail, even when the original log is very large. Missing logs are normal. */
export async function readLogTail(file: string): Promise<string | null> {
  let handle;
  try { handle = await open(file, 'r'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(Math.min(size, LOG_TAIL_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
    // A tail may start in the middle of a UTF-8 code point.
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

export class DiagnosticsService {
  constructor(private readonly deps: DiagnosticsDependencies) {}

  summary(): Promise<DiagnosticsSummary> { return this.deps.summary(); }

  private async snapshot() {
    const settings = this.deps.settings();
    const db = this.deps.db();
    const secrets = await this.deps.secrets();
    const redactPaths = createRedactor(this.deps.home(), this.deps.username(), secrets);
    const redact = createRedactor(this.deps.home(), this.deps.username(), [
      ...settings.asr.vocabulary, ...historyPrivateValues(db), ...secrets,
    ]);
    const [summary, polish, models] = await Promise.all([this.summary(), this.deps.polish(), this.deps.models()]);
    const permissions = this.deps.permissions();
    const report = {
      ...summary,
      settings: { ...settings, asr: { ...settings.asr, vocabulary: { count: settings.asr.vocabulary.length } } },
      whisperServer: this.deps.whisperServer(),
      permissions: { microphone: permissions.microphone, accessibility: permissions.accessibility },
      polish: { available: polish.available, reason: polish.reason, modelCount: polish.models.length },
      models: models.map(model => ({ key: model.key, installed: model.installed, partial: model.partialBytes > 0, active: model.active })),
      memory: this.deps.memory(), history: collectHistory(db),
    };
    // Content filtering applies to free-form errors and logs. Technical values in settings
    // must survive even when a vocabulary term happens to be "en", "auto" or a model name.
    if (report.whisperServer.reason) report.whisperServer.reason = redact(report.whisperServer.reason);
    if (report.memory.reason) report.memory.reason = redact(report.memory.reason);
    // Truncate after redaction so a private value cannot be cut into an unrecognizable fragment.
    for (const row of report.history.recent) row.errorMessage = row.errorMessage === null ? null : redact(row.errorMessage).slice(0, 200);
    return { report: redactJson(report, redactPaths), redact };
  }

  async collect() { return (await this.snapshot()).report; }

  async export(targetZipPath: string): Promise<string> {
    const temporary = await mkdtemp(path.join(this.deps.tempDirectory(), 'waae-diagnostics-'));
    // The folder inside the archive is named after the zip, not the random temp directory
    const directory = path.join(temporary, path.basename(targetZipPath, path.extname(targetZipPath)));
    try {
      await mkdir(directory);
      const { report, redact } = await this.snapshot();
      await writeFile(path.join(directory, 'diagnostics.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
      await writeFile(path.join(directory, 'README.txt'), README, { mode: 0o600 });
      const logFile = this.deps.logFile();
      await mkdir(path.join(directory, 'logs'));
      for (const [file, name] of [[logFile, 'main.log'], [path.join(path.dirname(logFile), 'main.old.log'), 'main.old.log']]) {
        const tail = await readLogTail(file);
        if (tail !== null) {
          const safe = Buffer.from(redact(tail));
          // Redaction may increase byte length. Enforce the cap on what is actually written.
          await writeFile(path.join(directory, 'logs', name), safe.subarray(Math.max(0, safe.length - LOG_TAIL_BYTES)), { mode: 0o600 });
        }
      }
      if (this.deps.zip) await this.deps.zip(directory, targetZipPath);
      else await execFileAsync('/usr/bin/ditto', ['-c', '-k', '--keepParent', directory, targetZipPath]);
      return targetZipPath;
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
}
