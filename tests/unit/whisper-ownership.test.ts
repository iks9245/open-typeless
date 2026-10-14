import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { findOwnedWhisperProcess } from '../../src/main/services/whisper-server/lib/ownership';
import type { WhisperOwnershipDependencies } from '../../src/main/services/whisper-server/types';

describe('whisper ownership', () => {
  const pidFile = '/fake/whisper-server.pid';
  const record = { pid: 1234, binary: '/fake/bin/whisper-server', port: 8080, startedAt: 1000 };
  let deps: WhisperOwnershipDependencies;
  let kill: MockInstance<typeof process.kill>;

  beforeEach(() => {
    deps = {
      readFile: vi.fn(async () => JSON.stringify(record)),
      writeFile: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
      processAlive: vi.fn(() => true),
      commandOf: vi.fn(async () => `${record.binary} -m /fake/model.bin --port 8080 --host 127.0.0.1`),
    };
    // Intercept any accidental OS signal, including the default liveness probe.
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for a missing PID file without checking or signalling a process', async () => {
    deps.readFile = vi.fn(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    expect(await findOwnedWhisperProcess(pidFile, 8080, deps)).toBeNull();
    expect(deps.readFile).toHaveBeenCalledWith(pidFile);
    expect(deps.unlink).not.toHaveBeenCalled();
    expect(deps.processAlive).not.toHaveBeenCalled();
    expect(deps.commandOf).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it.each(['--port 8080 --host 127.0.0.1', '--port 8080', '--port 8080\n'])('adopts a live matching process with port argument %j', async (argumentsText) => {
    deps.commandOf = vi.fn(async () => `${record.binary} ${argumentsText}`);
    expect(await findOwnedWhisperProcess(pidFile, 8080, deps)).toEqual(record);
    expect(deps.processAlive).toHaveBeenCalledWith(record.pid);
    expect(deps.commandOf).toHaveBeenCalledWith(record.pid);
    expect(deps.unlink).not.toHaveBeenCalled();
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it.each([
    { reason: 'a dead PID', alive: false },
    { reason: 'a command without the binary', command: '/fake/other-server --port 8080' },
    { reason: 'a longer numeric port', command: `${record.binary} --port 80801` },
    { reason: 'a port with trailing text', command: `${record.binary} --port 8080x` },
    { reason: 'a mismatched record port', content: JSON.stringify({ ...record, port: 9000 }) },
    { reason: 'malformed JSON', content: '{broken' },
    { reason: 'a structurally invalid record', content: JSON.stringify({ ...record, pid: '1234' }) },
  ])('removes the PID file for $reason without signalling any process', async ({ alive, command, content }) => {
    if (alive !== undefined) deps.processAlive = vi.fn(() => alive);
    if (command !== undefined) deps.commandOf = vi.fn(async () => command);
    if (content !== undefined) deps.readFile = vi.fn(async () => content);
    expect(await findOwnedWhisperProcess(pidFile, 8080, deps)).toBeNull();
    expect(deps.unlink).toHaveBeenCalledTimes(1);
    expect(deps.unlink).toHaveBeenCalledWith(pidFile);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('returns null and removes the PID file when command inspection throws', async () => {
    deps.commandOf = vi.fn(async () => { throw new Error('inspection denied'); });
    expect(await findOwnedWhisperProcess(pidFile, 8080, deps)).toBeNull();
    expect(deps.unlink).toHaveBeenCalledTimes(1);
    expect(deps.unlink).toHaveBeenCalledWith(pidFile);
    expect(kill).not.toHaveBeenCalled();
  });
});
