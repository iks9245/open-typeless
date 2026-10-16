import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODEL_CATALOG } from '../../src/shared/constants/model-catalog';
import type { ModelDownloadProgress } from '../../src/shared/types/model-download';
import { ModelDownloadService, type ModelDownloadDependencies } from '../../src/main/services/model-download/model-download.service';
import { loadModelCatalog, validateCatalog } from '../../src/main/services/model-download/catalog';

const bytes = Buffer.concat([Buffer.from('lmgg'), Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251))]);
const hash = createHash('sha256').update(bytes).digest('hex');
const entry = { ...MODEL_CATALOG[1], key: 'test-model', fileName: 'ggml-test-model.bin', size: bytes.length, sha256: hash, url: 'https://huggingface.co/test/file' };
const temporary: string[] = [];
const services: ModelDownloadService[] = [];
const servers: http.Server[] = [];
const space = vi.fn(async () => ({ bavail: 10000000, bsize: 4096 })) as unknown as NonNullable<ModelDownloadDependencies['statfs']>;
const reply = (content: Uint8Array = bytes, status = 200, headers?: Record<string, string>) => vi.fn(async () => new Response(content, { status, headers })) as unknown as typeof fetch;

async function make(overrides: Partial<ModelDownloadDependencies> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'model-download-'));
  temporary.push(root);
  const service = new ModelDownloadService({
    catalog: [entry], directories: { userData: () => root, homedir: () => path.join(root, 'home') },
    statfs: space, fetch: reply(), selectedModel: () => null, runningModel: () => null, clearSelectedModel: vi.fn(), ...overrides,
  });
  services.push(service);
  const part = path.join(root, 'models', '.partial', `${entry.fileName}.part`);
  return { service, root, part, sidecar: `${part}.json`, final: path.join(root, 'models', entry.fileName) };
}
async function partial(files: Awaited<ReturnType<typeof make>>, count = 1000, sha256 = hash) {
  await mkdir(path.dirname(files.part), { recursive: true });
  await writeFile(files.part, bytes.subarray(0, count));
  await writeFile(files.sidecar, JSON.stringify({ key: entry.key, size: entry.size, sha256 }));
}
function terminal(service: ModelDownloadService): Promise<ModelDownloadProgress> {
  return new Promise(resolve => {
    const listener = (progress: ModelDownloadProgress) => {
      if (['completed', 'failed', 'cancelled'].includes(progress.state)) { service.off('progress', listener); resolve(progress); }
    };
    service.on('progress', listener);
  });
}
async function start(service: ModelDownloadService) {
  const done = terminal(service);
  service.start(entry.key);
  return done;
}
async function exists(file: string) { return stat(file).then(() => true, () => false); }

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.cancel()));
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('model download streaming and persistence', () => {
  it('downloads, hashes, atomically publishes and removes the sidecar', async () => {
    const files = await make();
    const events: ModelDownloadProgress[] = [];
    files.service.on('progress', value => events.push(value));
    expect((await start(files.service)).state).toBe('completed');
    expect(await readFile(files.final)).toEqual(bytes);
    expect(await exists(files.part)).toBe(false);
    expect(await exists(files.sidecar)).toBe(false);
    expect(events.map(event => event.state)).toContain('verifying');
    expect(JSON.stringify(events)).not.toContain(files.root);
  });

  it('resumes 206 and hashes the preexisting bytes', async () => {
    const fetcher = reply(bytes.subarray(1000), 206, { 'content-range': `bytes 1000-${bytes.length - 1}/${bytes.length}` });
    const files = await make({ fetch: fetcher });
    await partial(files);
    expect((await start(files.service)).state).toBe('completed');
    expect(fetcher).toHaveBeenCalledWith(entry.url, expect.objectContaining({ headers: expect.objectContaining({ Range: 'bytes=1000-' }), redirect: 'follow' }));
    expect(await readFile(files.final)).toEqual(bytes);
  });

  it('restarts when Range is ignored and checks full disk space again', async () => {
    const disk = vi.fn(async () => ({ bavail: 10000000, bsize: 4096 }));
    const files = await make({ statfs: disk as unknown as typeof space });
    await partial(files);
    expect((await start(files.service)).state).toBe('completed');
    expect(await readFile(files.final)).toEqual(bytes);
    expect(disk).toHaveBeenCalledTimes(2);
  });

  it('discards stale metadata before downloading', async () => {
    const fetcher = reply();
    const files = await make({ fetch: fetcher });
    await partial(files, 1000, '0'.repeat(64));
    expect((await files.service.catalog())[0].partialBytes).toBe(0);
    expect((await start(files.service)).state).toBe('completed');
    expect(fetcher).toHaveBeenCalledWith(entry.url, expect.objectContaining({ headers: { 'Accept-Encoding': 'identity' } }));
  });

  it('verifies a complete partial without another request', async () => {
    const fetcher = reply();
    const files = await make({ fetch: fetcher });
    await partial(files, bytes.length);
    expect((await start(files.service)).state).toBe('completed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('deletes partials after SHA-256 mismatch', async () => {
    const files = await make({ catalog: [{ ...entry, sha256: '0'.repeat(64) }] });
    expect(await start(files.service)).toMatchObject({ state: 'failed', error: '檔案校驗失敗，請重新下載' });
    expect(await exists(files.part)).toBe(false);
    expect(await exists(files.sidecar)).toBe(false);
    expect(await exists(files.final)).toBe(false);
  });

  it('rejects an oversized body and never publishes it', async () => {
    const files = await make({ fetch: reply(Buffer.concat([bytes, Buffer.from('x')])) });
    expect(await start(files.service)).toMatchObject({ state: 'failed', error: '檔案大小超出預期，請重新下載' });
    expect(await exists(files.final)).toBe(false);
    expect(await exists(files.part)).toBe(false);
  });

  it('keeps an interrupted short transfer for retry and sanitizes network errors', async () => {
    const files = await make({ fetch: reply(bytes.subarray(0, 1000)) });
    expect(await start(files.service)).toMatchObject({ state: 'failed', receivedBytes: 1000, error: '下載中斷，可以稍後繼續' });
    expect(await readFile(files.part)).toEqual(bytes.subarray(0, 1000));
    await files.service.discard(entry.key);
    expect(await exists(files.part)).toBe(false);
    const broken = await make({ fetch: vi.fn(async () => { throw new Error('/private/path https://cdn/?token=secret'); }) });
    expect((await start(broken.service)).error).toBe('下載中斷，可以稍後繼續');
  });

  it('logs keys, sizes and error codes but never URLs, paths or tokens', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const ok = await make({ logger });
    expect(await start(ok.service)).toMatchObject({ state: 'completed' });
    const failing = Object.assign(new TypeError('fetch failed https://cdn/?token=secret /private/path'), { cause: { code: 'ECONNRESET' } });
    const broken = await make({ logger, fetch: vi.fn(async () => { throw failing; }) });
    expect(await start(broken.service)).toMatchObject({ state: 'failed' });
    expect(logger.info).toHaveBeenCalledWith('Model download completed', expect.objectContaining({ key: entry.key, bytes: entry.size }));
    expect(logger.warn).toHaveBeenCalledWith('Model download failed', expect.objectContaining({ key: entry.key, code: 'ECONNRESET' }));
    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toMatch(/https?:|token|secret|private|huggingface/);
  });

  it('fails a stalled request, without retry', async () => {
    const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const files = await make({ fetch: fetcher as typeof fetch, stallTimeoutMs: 25 });
    expect(await start(files.service)).toMatchObject({ state: 'failed', error: '下載中斷，可以稍後繼續' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('enforces the stall timeout after response headers as well', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true }); },
    })));
    const files = await make({ fetch: fetcher as typeof fetch, stallTimeoutMs: 25 });
    expect((await start(files.service)).state).toBe('failed');
  });

  it('cancels after bytes, retains the partial and rejects a second start', async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1000));
        init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
      },
    })));
    const files = await make({ fetch: fetcher as typeof fetch, now: (() => { let time = 0; return () => time += 300; })() });
    const transferred = new Promise<void>(resolve => files.service.on('progress', progress => { if (progress.receivedBytes === 1000) resolve(); }));
    const done = terminal(files.service);
    files.service.start(entry.key);
    expect(() => files.service.start(entry.key)).toThrow('已有模型');
    await transferred;
    await files.service.cancel();
    expect(await done).toMatchObject({ state: 'cancelled', error: null, receivedBytes: 1000 });
    expect(await readFile(files.part)).toEqual(bytes.subarray(0, 1000));
    await files.service.discard(entry.key);
    expect(await exists(files.sidecar)).toBe(false);
  });

  it('allows immediate cancellation before the transfer starts', async () => {
    const fetcher = reply();
    const files = await make({ fetch: fetcher });
    const done = terminal(files.service);
    files.service.start(entry.key);
    await files.service.cancel();
    expect(await done).toMatchObject({ state: 'cancelled', receivedBytes: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await exists(files.final)).toBe(false);
  });

  it('treats malformed sidecar values as stale metadata', async () => {
    const files = await make();
    await partial(files);
    await writeFile(files.sidecar, 'null');
    expect((await files.service.catalog())[0].partialBytes).toBe(0);
    expect((await start(files.service)).state).toBe('completed');
  });

  it('rejects insufficient space before fetching', async () => {
    const fetcher = reply();
    const files = await make({ fetch: fetcher, statfs: vi.fn(async () => ({ bavail: 1, bsize: 1 })) as unknown as typeof space });
    expect((await start(files.service)).error).toMatch(/^硬碟空間不足：需要 .+，剩下 /);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects non-catalog keys synchronously', async () => {
    const { service } = await make();
    expect(() => service.start('unknown')).toThrow('未知的模型');
    await expect(service.discard('../bad')).rejects.toThrow('未知的模型');
  });

  it('rejects incorrect Content-Range without corrupting the partial', async () => {
    const files = await make({ fetch: reply(bytes, 206, { 'content-range': `bytes 0-${bytes.length - 1}/${bytes.length}` }) });
    await partial(files);
    expect((await start(files.service)).state).toBe('failed');
    expect((await stat(files.part)).size).toBe(1000);
  });

  it('throttles byte events to 4 per second and always emits state transitions', async () => {
    let now = 0;
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 10) controller.enqueue(bytes.subarray(i, i + 10));
        controller.close();
      },
    })));
    const files = await make({ fetch: fetcher as typeof fetch, now: () => { now += 10; return now; } });
    const events: { time: number; progress: ModelDownloadProgress }[] = [];
    files.service.on('progress', progress => events.push({ time: now, progress }));
    expect((await start(files.service)).state).toBe('completed');
    const downloading = events.filter(event => event.progress.state === 'downloading');
    expect(downloading.length).toBeGreaterThan(2);
    for (let i = 1; i < downloading.length; i++) expect(downloading[i].time - downloading[i - 1].time).toBeGreaterThanOrEqual(250);
    expect(events.slice(-2).map(event => event.progress.state)).toEqual(['verifying', 'completed']);
    expect(downloading.some(event => event.progress.bytesPerSecond > 0 && event.progress.etaSeconds !== null)).toBe(true);
  });
});

describe('catalog and deletion', () => {
  it('reports exact-size installed, partial and selected/running flags without paths', async () => {
    const files = await make({ selectedModel: () => `whisper.cpp/${entry.fileName}` });
    await partial(files);
    await writeFile(files.final, bytes.subarray(0, 10));
    expect((await files.service.catalog())[0]).toMatchObject({ installed: false, partialBytes: 1000, active: false, modelId: null });
    const external = path.join(files.root, 'home', 'whisper.cpp', 'models');
    await mkdir(external, { recursive: true });
    await writeFile(path.join(external, entry.fileName), bytes);
    const catalog = await files.service.catalog();
    expect(catalog[0]).toMatchObject({ installed: true, partialBytes: 1000, active: true, modelId: `whisper.cpp/${entry.fileName}` });
    expect(JSON.stringify(catalog)).not.toContain(files.root);
    const running = await make({ runningModel: () => `app/${entry.fileName}` });
    await mkdir(path.dirname(running.final), { recursive: true });
    await writeFile(running.final, bytes);
    expect((await running.service.catalog())[0].active).toBe(true);
  });

  it('resets the selected model before deleting the app file', async () => {
    let selected: string | null = `app/${entry.fileName}`;
    const clear = vi.fn(() => { selected = null; });
    const files = await make({ selectedModel: () => selected, clearSelectedModel: clear });
    await start(files.service);
    await files.service.delete(`app/${entry.fileName}`);
    expect(clear).toHaveBeenCalledOnce();
    expect(selected).toBeNull();
    expect(await exists(files.final)).toBe(false);
  });

  it('does not delete when resetting selected settings fails', async () => {
    const files = await make({ selectedModel: () => `app/${entry.fileName}`, clearSelectedModel: () => { throw new Error('/private/settings'); } });
    await start(files.service);
    await expect(files.service.delete(`app/${entry.fileName}`)).rejects.toThrow('無法刪除模型');
    expect(await exists(files.final)).toBe(true);
  });

  it('rejects external IDs, traversal, absolute paths and symlink targets', async () => {
    const files = await make();
    await start(files.service);
    for (const id of [`whisper.cpp/${entry.fileName}`, '../outside.bin', 'app/../outside.bin', '/tmp/outside.bin', 'app/a\\b.bin']) {
      await expect(files.service.delete(id)).rejects.toThrow();
    }
    const outside = path.join(files.root, 'outside.bin');
    await writeFile(outside, bytes);
    await symlink(outside, path.join(files.root, 'models', 'link.bin'));
    await expect(files.service.delete('app/link.bin')).rejects.toThrow();
    expect(await readFile(outside)).toEqual(bytes);
  });

  it('honors the override only when unpackaged and validates hosts and filenames', () => {
    const read = vi.fn(() => JSON.stringify([{ ...entry, url: 'http://127.0.0.1:1234/file' }]));
    expect(loadModelCatalog(true, { OPEN_TYPELESS_MODEL_CATALOG: '/test/catalog' }, read)).toEqual(MODEL_CATALOG);
    expect(read).not.toHaveBeenCalled();
    expect(loadModelCatalog(false, { OPEN_TYPELESS_MODEL_CATALOG: '/test/catalog' }, read)[0].key).toBe(entry.key);
    for (const url of ['http://example.com/file', 'https://huggingface.co.evil/file', 'https://huggingface.co/file?secret=1']) {
      expect(() => validateCatalog([{ ...entry, url }], true)).toThrow();
    }
    expect(() => validateCatalog([{ ...entry, fileName: '../outside.bin' }])).toThrow();
  });
});

describe('real Node fetch against a loopback HTTP server', () => {
  it.each(['fresh', 'resume', 'ignore-range', 'redirect'] as const)('%s streams and verifies', async mode => {
    const ranges: (string | undefined)[] = [];
    const server = http.createServer((request, response) => {
      ranges.push(request.headers.range);
      if (request.url === '/redirect') { response.writeHead(302, { location: '/file' }); response.end(); return; }
      const offset = mode === 'resume' ? Number(request.headers.range?.match(/\d+/)?.[0] ?? 0) : 0;
      response.writeHead(offset ? 206 : 200, offset ? { 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {});
      response.write(bytes.subarray(offset, offset + 200));
      response.end(bytes.subarray(offset + 200));
    });
    servers.push(server);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${mode === 'redirect' ? 'redirect' : 'file'}`;
    const files = await make({ catalog: [{ ...entry, url }], allowLoopback: true, fetch });
    if (mode === 'resume' || mode === 'ignore-range') await partial(files);
    expect((await start(files.service)).state).toBe('completed');
    expect(await readFile(files.final)).toEqual(bytes);
    if (mode === 'resume' || mode === 'ignore-range') expect(ranges[0]).toBe('bytes=1000-');
    if (mode === 'redirect') expect(ranges).toHaveLength(2);
  });
});
