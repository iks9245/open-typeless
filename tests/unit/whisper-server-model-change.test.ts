/** Lifecycle transitions without sockets, ps, or real child processes. */
import { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { WhisperServerService } from '../../src/main/services/whisper-server/whisper-server.service';
import type { WhisperServerDependencies } from '../../src/main/services/whisper-server/types';

function setup(external = false) {
  let model: string | null = null;
  const children: ChildProcess[] = [];
  const deps: WhisperServerDependencies = {
    spawn: vi.fn(() => {
      const child = new ChildProcess();
      Object.defineProperties(child, {
        pid: { value: 100 + children.length },
        stdout: { value: null }, stderr: { value: null },
      });
      child.kill = vi.fn(() => {
        Object.defineProperty(child, 'exitCode', { value: 0 });
        child.emit('exit', 0, 'SIGTERM');
        return true;
      });
      children.push(child);
      return child;
    }),
    healthCheck: vi.fn(async () => external || children.some(child => child.exitCode === null)),
    now: Date.now, timers: { setTimeout, clearTimeout },
    getModel: () => model, getServerUrl: () => 'http://localhost:8080', pidFilePath: () => '/app/server.pid',
    kill: vi.fn(),
    discovery: {
      env: {}, homedir: () => '/home', userData: () => '/app', readDirectory: () => [],
      fileExists: file => ['/home/whisper.cpp/build/bin/whisper-server', '/home/whisper.cpp/models/ggml-base.bin'].includes(file),
      statFile: () => ({ isFile: () => true, size: 100 }), readHeader: () => Buffer.from('lmgg'),
    },
    ownership: {
      readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      writeFile: vi.fn(async () => undefined), unlink: vi.fn(async () => undefined),
      processAlive: () => true, commandOf: vi.fn(async () => ''),
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { service: new WhisperServerService(deps), deps, children, select: (value: string | null) => { model = value; } };
}

describe('whisper model changes', () => {
  it('restarts a managed process and launches the selected model', async () => {
    const { service, deps, children, select } = setup();
    await service.start();
    expect(service.status()).toMatchObject({ mode: 'managed', state: 'ready' });
    select('app/cantonese.bin');
    const restart = service.modelChanged();
    expect(service.status().state).toBe('starting');
    await restart;
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
    expect(deps.spawn).toHaveBeenLastCalledWith(expect.any(String), expect.arrayContaining(['-m', '/app/models/cantonese.bin']), expect.any(Object));
    expect(service.status()).toMatchObject({ mode: 'managed', state: 'ready', modelId: 'app/cantonese.bin' });
    await service.stop();
  });

  it('leaves external servers running and explains the lock', async () => {
    const { service, deps, select } = setup(true);
    await service.start();
    select('app/cantonese.bin');
    await service.modelChanged();
    expect(service.status()).toMatchObject({ mode: 'external', state: 'ready', modelId: null, modelLocked: 'external' });
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.kill).not.toHaveBeenCalled();
  });

  it.each([false, true])('stops a verified adopted process when its model mismatches or changes (initial mismatch: %s)', async mismatch => {
    const { service, deps, select } = setup();
    let orphanAlive = true;
    const record = { pid: 42, binary: '/home/whisper.cpp/build/bin/whisper-server', port: 8080, startedAt: 0 };
    deps.ownership.readFile = async () => JSON.stringify(record);
    deps.ownership.processAlive = () => orphanAlive;
    deps.ownership.commandOf = async () => `${record.binary} -m /home/whisper.cpp/models/ggml-base.bin --port 8080`;
    deps.kill = vi.fn(() => { orphanAlive = false; });
    if (mismatch) select('app/cantonese.bin');
    else deps.healthCheck = vi.fn(async () => true);
    await service.start();
    if (!mismatch) {
      expect(service.status()).toMatchObject({ mode: 'adopted', modelId: 'whisper.cpp/ggml-base.bin' });
      select('app/cantonese.bin');
      // After stopping the orphan the readiness probe must not report an external server.
      deps.healthCheck = vi.fn(async () => vi.mocked(deps.spawn).mock.calls.length > 0);
      await service.modelChanged();
    }
    expect(deps.kill).toHaveBeenCalledWith(42, 'SIGTERM');
    expect(service.status()).toMatchObject({ mode: 'managed', state: 'ready', modelId: 'app/cantonese.bin' });
    expect(deps.spawn).toHaveBeenLastCalledWith(record.binary, expect.arrayContaining(['-m', '/app/models/cantonese.bin']), expect.any(Object));
    await service.stop();
  });

  it('warns and reports fallback for an invalid selection', async () => {
    const { service, deps, select } = setup();
    select('app/broken.bin');
    deps.discovery.readHeader = () => Buffer.from('bad!');
    await service.start();
    expect(service.status()).toMatchObject({ modelFallback: true, modelId: 'whisper.cpp/ggml-base.bin' });
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('automatic selection'));
    await service.stop();
  });

  it('keeps fallback visible when no automatic model is available', async () => {
    const { service, deps, select } = setup();
    select('app/broken.bin');
    deps.discovery.readHeader = () => Buffer.from('bad!');
    deps.discovery.fileExists = file => file.endsWith('/whisper-server');
    await service.start();
    expect(service.status()).toMatchObject({ mode: 'unavailable', state: 'failed', modelFallback: true, modelId: null });
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('automatic selection'));
  });

  it('cancels a restart stopped during an asynchronous ownership lookup', async () => {
    const { service, deps } = setup();
    await service.start();
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lookup = new Promise<void>(resolve => { entered = resolve; });
    deps.ownership.readFile = async () => {
      entered();
      await gate;
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    };
    const restarting = service.restart();
    await lookup;
    const stopping = service.stop();
    release();
    await Promise.all([restarting, stopping]);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(service.status().state).toBe('stopped');
  });

  it('serializes rapid changes and cancels queued restarts on stop', async () => {
    const { service, deps, select } = setup();
    await service.start();
    select('app/first.bin');
    const first = service.modelChanged();
    select('app/second.bin');
    const second = service.modelChanged();
    await Promise.all([first, second]);
    expect(service.status()).toMatchObject({ state: 'ready', modelId: 'app/second.bin' });
    const pending = [service.restart(), service.restart()];
    await service.stop();
    const launches = vi.mocked(deps.spawn).mock.calls.length;
    await Promise.all(pending);
    expect(deps.spawn).toHaveBeenCalledTimes(launches);
    expect(service.status().state).toBe('stopped');
  });
});
