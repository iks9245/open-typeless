/**
 * WhisperServerService against real child processes, real HTTP and real `ps`,
 * using tests/fixtures/fake-whisper-server.mjs in place of whisper.cpp.
 * Needs loopback ports and `ps`, so it cannot run inside restricted sandboxes.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandOf, processAlive } from '../../src/main/services/whisper-server/lib/ownership';
import { WhisperServerService } from '../../src/main/services/whisper-server/whisper-server.service';

const FIXTURE = path.resolve(__dirname, '../fixtures/fake-whisper-server.mjs');

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as net.AddressInfo;
    server.close(() => resolve(port));
  });
});

const alive = (pid: number): boolean => processAlive(pid);
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('WhisperServerService lifecycle', () => {
  let dir: string;
  let port: number;
  let pidFile: string;
  const cleanups: (() => void)[] = [];
  const services: WhisperServerService[] = [];

  const createService = (env: Record<string, string | undefined> = {}): WhisperServerService => {
    const service = new WhisperServerService({
      spawn: (binary, args, options) => spawn(binary, args, options),
      healthCheck: async (url, signal) => {
        const response = await fetch(url, { signal, redirect: 'manual' });
        void response.body?.cancel();
        return response.status === 200;
      },
      timers: { setTimeout, clearTimeout },
      now: Date.now,
      discovery: {
        env: { WHISPER_SERVER_BIN: FIXTURE, WHISPER_MODEL_PATH: path.join(dir, 'model.bin'), ...env },
        // An empty home keeps the real ~/whisper.cpp out of discovery
        homedir: () => dir,
        fileExists: (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
        readDirectory: (directory) => readdirSync(directory),
      },
      ownership: {
        readFile: (file) => readFile(file, 'utf8'),
        writeFile: (file, content) => writeFile(file, content, { mode: 0o600 }),
        unlink,
        processAlive,
        commandOf,
      },
      kill: (pid, signal) => { process.kill(pid, signal); },
      pidFilePath: () => pidFile,
      getServerUrl: () => `http://127.0.0.1:${port}`,
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    services.push(service);
    return service;
  };

  const spawnOrphan = (): ChildProcess => {
    const child = spawn(FIXTURE, ['-m', path.join(dir, 'model.bin'), '-l', 'auto', '--host', '127.0.0.1', '--port', String(port)], { stdio: 'ignore' });
    cleanups.push(() => { if (child.pid && alive(child.pid)) process.kill(child.pid, 'SIGKILL'); });
    return child;
  };

  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'whisper-lifecycle-'));
    writeFileSync(path.join(dir, 'model.bin'), 'model');
    pidFile = path.join(dir, 'whisper-server.pid');
    port = await freePort();
    process.env.FAKE_DELAY_MS = '300';
    delete process.env.FAKE_EXIT_AFTER_MS;
    process.env.FAKE_ARGS_FILE = path.join(dir, 'args.json');
  });

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.stop()));
    for (const cleanup of cleanups.splice(0)) cleanup();
    delete process.env.FAKE_EXIT_AFTER_MS;
    rmSync(dir, { recursive: true, force: true });
  });

  it('spawns the server with the expected arguments and stops it', async () => {
    const service = createService();
    await service.start();

    const status = service.status();
    expect(status).toMatchObject({ mode: 'managed', state: 'ready', binary: FIXTURE, vadModel: null });
    const pid = status.pid as number;
    expect(alive(pid)).toBe(true);

    const args = JSON.parse(readFileSync(path.join(dir, 'args.json'), 'utf8')) as string[];
    expect(args).toEqual(['-m', path.join(dir, 'model.bin'), '-l', 'auto', '--host', '127.0.0.1', '--port', String(port)]);
    expect(JSON.parse(readFileSync(pidFile, 'utf8')).pid).toBe(pid);
    expect(await commandOf(pid)).toContain(`--port ${port}`);

    await service.stop();
    expect(alive(pid)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
    expect(service.status().state).toBe('stopped');
  });

  it('lets callers wait for a server that is still starting', async () => {
    process.env.FAKE_DELAY_MS = '1000';
    const service = createService();
    void service.start();
    await wait(50);

    expect(service.status().state).toBe('starting');
    expect(await service.waitUntilReady(10000)).toBe(true);
    expect(service.status().state).toBe('ready');
  });

  it('uses a server that already answers on the port and never stops it', async () => {
    const existing = http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); });
    await new Promise<void>((resolve) => existing.listen(port, '127.0.0.1', resolve));
    cleanups.push(() => existing.close());

    const service = createService();
    await service.start();
    expect(service.status()).toMatchObject({ mode: 'external', state: 'ready', pid: null });

    await service.stop();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    expect(response.status).toBe(200);
    expect(existsSync(pidFile)).toBe(false);
  });

  it('restarts the server after an unexpected exit', async () => {
    const service = createService();
    await service.start();
    const first = service.status().pid as number;

    process.kill(first, 'SIGKILL');
    await wait(200);
    expect(service.status().state).toBe('starting');
    expect(await service.waitUntilReady(10000)).toBe(true);

    const second = service.status().pid as number;
    expect(second).not.toBe(first);
    expect(alive(second)).toBe(true);
  });

  it('gives up after more than 3 unexpected exits within 60 seconds', async () => {
    // Each run must outlive the 500 ms readiness poll: a server that exits before it is
    // ready fails at once without restarts (see the next test)
    process.env.FAKE_DELAY_MS = '100';
    process.env.FAKE_EXIT_AFTER_MS = '1500';
    const service = createService();
    await service.start();

    // Backoff is 1 s, 2 s and 4 s before the fourth exit fails the service
    const deadline = Date.now() + 25000;
    while (service.status().state !== 'failed' && Date.now() < deadline) await wait(200);
    expect(service.status()).toMatchObject({ state: 'failed', reason: 'whisper-server exceeded 3 unexpected exits within 60 seconds' });
  }, 30000);

  it('fails without restarting when the server exits before becoming ready', async () => {
    process.env.FAKE_DELAY_MS = '100';
    process.env.FAKE_EXIT_AFTER_MS = '50';
    const service = createService();
    await service.start();

    expect(service.status()).toMatchObject({ state: 'failed', reason: 'whisper-server exited before becoming ready', pid: null });
    await wait(1500);
    expect(service.status().state).toBe('failed');
  });

  it('adopts a server left behind by a previous launch and stops it', async () => {
    const orphan = spawnOrphan();
    const pid = orphan.pid as number;
    writeFileSync(pidFile, JSON.stringify({ pid, binary: FIXTURE, port, startedAt: Date.now() }));
    await wait(500);

    const service = createService();
    await service.start();
    expect(service.status()).toMatchObject({ mode: 'adopted', state: 'ready', pid });

    await service.stop();
    expect(alive(pid)).toBe(false);
    expect(existsSync(pidFile)).toBe(false);
  });

  it('never adopts or signals an unrelated process named in the pid file', async () => {
    const unrelated = spawn('sleep', ['30'], { stdio: 'ignore' });
    const unrelatedPid = unrelated.pid as number;
    cleanups.push(() => { if (alive(unrelatedPid)) process.kill(unrelatedPid, 'SIGKILL'); });
    writeFileSync(pidFile, JSON.stringify({ pid: unrelatedPid, binary: FIXTURE, port, startedAt: Date.now() }));

    const service = createService();
    await service.start();
    expect(service.status().mode).toBe('managed');
    expect(service.status().pid).not.toBe(unrelatedPid);

    await service.stop();
    expect(alive(unrelatedPid)).toBe(true);
  });

  it('reports unavailable when no whisper-server binary can be found', async () => {
    const service = createService({ WHISPER_SERVER_BIN: path.join(dir, 'missing') });
    await service.start();

    expect(service.status()).toMatchObject({ mode: 'unavailable', state: 'failed', reason: 'whisper-server binary not found' });
    expect(await service.waitUntilReady(100)).toBe(false);
  });
});
