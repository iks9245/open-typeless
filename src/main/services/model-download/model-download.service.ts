import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelCatalogEntry, ModelCatalogState, ModelDownloadProgress } from '../../../shared/types/model-download';
import { WHISPER_MODEL_ID_PATTERN, modelDirectory, type WhisperModelDependencies } from '../whisper-server/lib/models';
import { validateCatalog } from './catalog';

const INTERRUPTED = '下載中斷，可以稍後繼續';
export class ModelDownloadError extends Error {}

export interface ModelDownloadDependencies {
  catalog: readonly ModelCatalogEntry[];
  directories: Pick<WhisperModelDependencies, 'userData' | 'homedir'>;
  fetch?: typeof fetch;
  statfs?: typeof statfs;
  now?: () => number;
  stallTimeoutMs?: number;
  /** Only used with the unpackaged development catalog or injected test catalogs. */
  allowLoopback?: boolean;
  selectedModel: () => string | null;
  runningModel: () => string | null;
  clearSelectedModel: () => void;
  /** Keys, sizes, durations and error codes only: never URLs or paths */
  logger?: { info(message: string, details?: unknown): void; warn(message: string, details?: unknown): void };
}

/** One writer, streaming transfer/hash, with only safe messages crossing the IPC boundary. */
export class ModelDownloadService extends EventEmitter {
  private readonly entries: ModelCatalogEntry[];
  private readonly now: () => number;
  private job: { key: string; controller: AbortController; cancelled: boolean; done: Promise<void> } | null = null;
  private progress: ModelDownloadProgress | null = null;
  private lastEmitted = -Infinity;
  // Serialize discard/delete with start without letting an async filesystem check race a writer.
  private mutating = false;

  constructor(private readonly deps: ModelDownloadDependencies) {
    super();
    this.entries = validateCatalog(deps.catalog, deps.allowLoopback);
    this.now = deps.now ?? Date.now;
  }

  private entry(key: string): ModelCatalogEntry {
    const entry = this.entries.find(entry => entry.key === key);
    if (!entry) throw new ModelDownloadError('未知的模型');
    return entry;
  }

  private directory(source: 'app' | 'whisper.cpp' = 'app'): string {
    // Reuse the existing model source layout, without exporting these paths.
    return modelDirectory(source, this.deps.directories);
  }

  private files(entry: ModelCatalogEntry) {
    const partialDir = path.join(this.directory(), '.partial');
    const part = path.join(partialDir, `${entry.fileName}.part`);
    return { partialDir, part, sidecar: `${part}.json`, final: path.join(this.directory(), entry.fileName) };
  }

  private async fileSize(file: string): Promise<number | null> {
    try {
      const info = await lstat(file);
      return info.isFile() ? info.size : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async partialBytes(entry: ModelCatalogEntry): Promise<number | null> {
    const { part, sidecar, partialDir } = this.files(entry);
    try {
      if (!(await lstat(partialDir)).isDirectory()) return null;
      if (await this.fileSize(sidecar) === null) return null;
      const meta = JSON.parse(await readFile(sidecar, 'utf8'));
      if (!meta || typeof meta !== 'object' || meta.key !== entry.key || meta.sha256 !== entry.sha256 || meta.size !== entry.size) return null;
      const bytes = await this.fileSize(part);
      return bytes !== null && bytes <= entry.size ? bytes : null;
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async catalog(): Promise<ModelCatalogState[]> {
    try {
      const selected = this.deps.selectedModel();
      const running = this.deps.runningModel();
      return await Promise.all(this.entries.map(async entry => {
        const ids: string[] = [];
        for (const source of ['app', 'whisper.cpp'] as const) {
          if (await this.fileSize(path.join(this.directory(source), entry.fileName)) === entry.size) ids.push(`${source}/${entry.fileName}`);
        }
        const modelId = ids.find(id => id === selected) ?? ids.find(id => id === running) ?? ids[0] ?? null;
        return {
          ...entry, installed: modelId !== null, modelId,
          partialBytes: await this.partialBytes(entry) ?? 0,
          active: ids.some(id => id === selected || id === running),
          progress: this.progress?.key === entry.key ? { ...this.progress } : null,
        };
      }));
    } catch { throw new ModelDownloadError('無法讀取模型目錄'); }
  }

  private emitProgress(patch: Partial<ModelDownloadProgress>, force = false): void {
    if (!this.progress) return;
    const stateChanged = patch.state !== undefined && patch.state !== this.progress.state;
    this.progress = { ...this.progress, ...patch };
    const now = this.now();
    if (force || stateChanged || now - this.lastEmitted >= 250) {
      this.lastEmitted = now;
      this.emit('progress', { ...this.progress });
    }
  }

  /** Claims the sole writer synchronously; transfer work begins without delaying IPC. */
  start(key: string): void {
    const entry = this.entry(key);
    if (this.job || this.mutating) throw new ModelDownloadError('已有模型正在下載或處理中');
    const job = { key, controller: new AbortController(), cancelled: false, done: Promise.resolve() };
    this.job = job;
    this.progress = {
      key, fileName: entry.fileName, state: 'idle', receivedBytes: 0, totalBytes: entry.size,
      bytesPerSecond: 0, etaSeconds: null, error: null,
    };
    const startedAt = this.now();
    this.deps.logger?.info('Model download started', { key });
    job.done = Promise.resolve().then(() => this.download(entry, job.controller.signal)).then(() => {
      this.job = null;
      this.deps.logger?.info('Model download completed', { key, bytes: entry.size, seconds: Math.round((this.now() - startedAt) / 1000) });
      this.emitProgress({ state: 'completed', bytesPerSecond: 0, etaSeconds: 0 });
    }).catch(error => {
      this.job = null;
      const receivedBytes = this.progress?.receivedBytes ?? 0;
      if (job.cancelled) {
        this.deps.logger?.info('Model download cancelled', { key, receivedBytes });
      } else {
        // Unexpected errors are reduced to their name and code, which carry no URL or path
        const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
        this.deps.logger?.warn('Model download failed', {
          key, receivedBytes,
          error: error instanceof ModelDownloadError ? error.message : error instanceof Error ? error.name : 'unknown',
          code: cause?.code ?? (error as { code?: string } | null)?.code ?? null,
        });
      }
      this.emitProgress({
        state: job.cancelled ? 'cancelled' : 'failed', bytesPerSecond: 0, etaSeconds: null,
        error: job.cancelled ? null : error instanceof ModelDownloadError ? error.message : INTERRUPTED,
      });
    });
    this.emitProgress({ state: 'downloading' }, true);
  }

  async cancel(): Promise<void> {
    const job = this.job;
    if (!job) return;
    job.cancelled = true;
    job.controller.abort();
    await job.done;
  }

  private async prepare(entry: ModelCatalogEntry): Promise<number> {
    const { partialDir, part, sidecar } = this.files(entry);
    await mkdir(partialDir, { recursive: true });
    if (!(await lstat(partialDir)).isDirectory()) throw new ModelDownloadError('無法建立下載暫存檔');
    const bytes = await this.partialBytes(entry);
    if (bytes !== null) return bytes;
    await rm(part, { force: true });
    await rm(sidecar, { force: true });
    await writeFile(sidecar, JSON.stringify({ key: entry.key, sha256: entry.sha256, size: entry.size }), { flag: 'wx', mode: 0o600 });
    return 0;
  }

  private async checkSpace(remaining: number): Promise<void> {
    const disk = await (this.deps.statfs ?? statfs)(this.directory());
    const free = Number(disk.bavail) * Number(disk.bsize);
    const needed = Math.ceil(remaining * 1.05 + 200 * 1024 ** 2);
    if (free < needed) {
      const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
      throw new ModelDownloadError(`硬碟空間不足：需要 ${size(needed)}，剩下 ${size(free)}`);
    }
  }

  private async download(entry: ModelCatalogEntry, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const { part, sidecar, final } = this.files(entry);
    let received = await this.prepare(entry);
    signal.throwIfAborted();
    await this.checkSpace(entry.size - received);
    let hash = createHash('sha256');
    if (received) {
      for await (const chunk of createReadStream(part, { signal })) hash.update(chunk);
    }
    signal.throwIfAborted();
    this.emitProgress({ receivedBytes: received });
    // A fully transferred partial (e.g. quit before rename) needs only verification.
    if (received < entry.size) {
      const request = new AbortController();
      const abort = () => request.abort();
      signal.addEventListener('abort', abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const resetStall = () => {
        clearTimeout(timer);
        timer = setTimeout(() => request.abort(), this.deps.stallTimeoutMs ?? 30000);
      };
      resetStall();
      try {
        const response = await (this.deps.fetch ?? fetch)(entry.url, {
          signal: request.signal, redirect: 'follow',
          headers: { 'Accept-Encoding': 'identity', ...(received ? { Range: `bytes=${received}-` } : {}) },
        });
        try {
          if (response.status !== 200 && response.status !== 206) throw new ModelDownloadError(INTERRUPTED);
          if (response.status === 206) {
            const range = response.headers.get('content-range');
            const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range ?? '');
            if (!match || Number(match[1]) !== received || Number(match[3]) !== entry.size || Number(match[2]) !== entry.size - 1) throw new ModelDownloadError(INTERRUPTED);
          } else if (received) {
            received = 0;
            hash = createHash('sha256');
            await this.checkSpace(entry.size);
            this.emitProgress({ receivedBytes: 0 });
          }
          if (!response.body) throw new ModelDownloadError(INTERRUPTED);
          const file = await open(part, received ? 'a' : 'w', 0o600);
          const samples = [{ time: this.now(), bytes: received }];
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value: chunk } = await reader.read();
              if (done) break;
              signal.throwIfAborted();
              if (!chunk.length) continue;
              resetStall();
              if (received + chunk.length > entry.size) {
                throw new ModelDownloadError('檔案大小超出預期，請重新下載');
              }
              await file.writeFile(chunk);
              hash.update(chunk);
              received += chunk.length;
              const now = this.now();
              samples.push({ time: now, bytes: received });
              while (samples.length > 2 && samples[1].time <= now - 3000) samples.shift();
              const seconds = (now - samples[0].time) / 1000;
              const speed = seconds > 0 ? (received - samples[0].bytes) / seconds : 0;
              this.emitProgress({ receivedBytes: received, bytesPerSecond: speed, etaSeconds: speed > 0 ? (entry.size - received) / speed : null });
            }
          } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
            await file.close();
          }
        } finally {
          // Also release bodies for rejected statuses/ranges and disk failures.
          if (response.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
        }
      } catch (error) {
        if (error instanceof ModelDownloadError && error.message === '檔案大小超出預期，請重新下載') {
          await rm(part, { force: true });
          await rm(sidecar, { force: true });
        }
        throw error;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        request.abort();
      }
    }
    signal.throwIfAborted();
    if (received !== entry.size) throw new ModelDownloadError(INTERRUPTED);
    this.emitProgress({ state: 'verifying', receivedBytes: received, bytesPerSecond: 0, etaSeconds: null });
    if (hash.digest('hex') !== entry.sha256) {
      await rm(part, { force: true });
      await rm(sidecar, { force: true });
      throw new ModelDownloadError('檔案校驗失敗，請重新下載');
    }
    signal.throwIfAborted();
    await rename(part, final);
    await rm(sidecar, { force: true });
  }

  async discard(key: string): Promise<void> {
    const entry = this.entry(key);
    if (this.job || this.mutating) throw new ModelDownloadError('請先取消下載');
    this.mutating = true;
    try {
      const { partialDir, part, sidecar } = this.files(entry);
      try {
        if (!(await lstat(partialDir)).isDirectory()) throw new Error();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      await rm(part, { force: true });
      await rm(sidecar, { force: true });
      if (this.progress?.key === key) this.emitProgress({ state: 'idle', receivedBytes: 0, error: null });
    } catch { throw new ModelDownloadError('無法捨棄下載'); }
    finally { this.mutating = false; }
  }

  async delete(modelId: string): Promise<void> {
    if (!WHISPER_MODEL_ID_PATTERN.test(modelId) || !modelId.startsWith('app/')) throw new ModelDownloadError('只能刪除 app 資料夾中的模型');
    const directory = path.resolve(this.directory());
    const file = path.resolve(directory, modelId.slice(4));
    if (path.dirname(file) !== directory) throw new ModelDownloadError('無效的模型');
    if (this.job || this.mutating) throw new ModelDownloadError('請先取消下載');
    this.mutating = true;
    try {
      if (await this.fileSize(file) === null) throw new ModelDownloadError('找不到模型');
      if (this.deps.selectedModel() === modelId) this.deps.clearSelectedModel();
      await rm(file);
    } catch (error) { throw error instanceof ModelDownloadError ? error : new ModelDownloadError('無法刪除模型'); }
    finally { this.mutating = false; }
  }
}
