import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { discoverWhisperServer, resolveWhisperEndpoint } from '../../src/main/services/whisper-server/lib/discovery';
import type { WhisperDiscoveryInputs, WhisperLaunchPlan } from '../../src/main/services/whisper-server/types';

describe('whisper discovery', () => {
  const home = '/fake/home';
  const models = path.join(home, 'whisper.cpp', 'models');
  const binaries = ['/env/whisper-server', `${home}/whisper.cpp/build/bin/whisper-server`, '/opt/homebrew/bin/whisper-server', '/usr/local/bin/whisper-server'];
  const modelNames = ['large-v3-turbo', 'large-v3', 'medium', 'small', 'base'];
  const modelPaths = modelNames.map((name) => path.join(models, `ggml-${name}.bin`));

  function dependencies(files: string[], env: WhisperDiscoveryInputs['env'] = {}, names: string[] = []): WhisperDiscoveryInputs {
    const existing = new Set(files);
    return { env, homedir: () => home, fileExists: (file) => existing.has(file), readDirectory: () => names };
  }

  function plan(deps: WhisperDiscoveryInputs, url = 'http://localhost:8080'): WhisperLaunchPlan {
    const result = discoverWhisperServer(url, deps);
    expect(result.available).toBe(true);
    if (result.available === false) throw new Error(result.reason);
    return result.plan;
  }

  it.each(binaries.map((binary, index) => ({ binary, index })))('selects $binary ahead of lower-priority binaries', ({ binary, index }) => {
    const deps = dependencies([...binaries.slice(index), modelPaths[0]], { WHISPER_SERVER_BIN: binaries[0] });
    expect(plan(deps).binary).toBe(binary);
  });

  it.each(modelNames.map((name, index) => ({ name, index })))('selects $name ahead of lower-priority models', ({ index }) => {
    expect(plan(dependencies([binaries[1], ...modelPaths.slice(index)])).model).toBe(modelPaths[index]);
  });

  it('selects an existing environment model override ahead of all bundled models', () => {
    const override = '/custom/model.bin';
    expect(plan(dependencies([binaries[1], override, ...modelPaths], { WHISPER_MODEL_PATH: override })).model).toBe(override);
  });

  it('falls back to discovered files when environment overrides do not exist', () => {
    const deps = dependencies([binaries[1], modelPaths[0]], { WHISPER_SERVER_BIN: '/missing/binary', WHISPER_MODEL_PATH: '/missing/model' });
    expect(plan(deps)).toMatchObject({ binary: binaries[1], model: modelPaths[0] });
  });

  it('reports a missing binary before attempting model discovery', () => {
    expect(discoverWhisperServer('http://localhost:8080', dependencies(modelPaths)))
      .toEqual({ available: false, reason: 'whisper-server binary not found' });
  });

  it('reports a missing model when a binary exists', () => {
    expect(discoverWhisperServer('http://localhost:8080', dependencies([binaries[1]])))
      .toEqual({ available: false, reason: 'no ggml model found' });
  });

  it('selects only ggml-silero BIN files for VAD and ignores for-tests files', () => {
    const names = ['for-tests-ggml-silero-v0.bin', 'ggml-silero-z.bin', 'ggml-silero-a.bin', 'ggml-silero-a.txt', 'ggml-base.bin'];
    const deps = dependencies([binaries[1], modelPaths[0], ...names.map((name) => path.join(models, name))], {}, names);
    expect(plan(deps).vadModel).toBe(path.join(models, 'ggml-silero-a.bin'));
  });

  it('never selects a for-tests VAD file even through an environment override', () => {
    const testModel = path.join(models, 'for-tests-ggml-silero-v6.2.0.bin');
    const deps = dependencies([binaries[1], modelPaths[0], testModel], { WHISPER_VAD_MODEL_PATH: testModel }, [path.basename(testModel)]);
    expect(plan(deps).vadModel).toBeNull();
    expect(plan(deps).args).not.toContain('--vad');
  });

  it('selects an existing VAD environment override ahead of directory candidates', () => {
    const override = '/custom/vad.bin';
    const candidate = 'ggml-silero-v6.2.0.bin';
    const deps = dependencies([binaries[1], modelPaths[0], override, path.join(models, candidate)], { WHISPER_VAD_MODEL_PATH: override }, [candidate]);
    expect(plan(deps).vadModel).toBe(override);
  });

  it('falls back from a missing VAD override to an existing directory candidate', () => {
    const candidate = 'ggml-silero-v6.2.0.bin';
    const deps = dependencies([binaries[1], modelPaths[0], path.join(models, candidate)], { WHISPER_VAD_MODEL_PATH: '/missing/vad.bin' }, [candidate]);
    expect(plan(deps).vadModel).toBe(path.join(models, candidate));
  });

  it('launches with model, auto language, loopback host and requested port without VAD flags when no VAD model exists', () => {
    const result = plan(dependencies([binaries[1], modelPaths[0]]), 'http://localhost:9010/path?query=1');
    expect(result).toMatchObject({ host: '127.0.0.1', port: 9010, vadModel: null });
    expect(result.args).toEqual(['-m', modelPaths[0], '-l', 'auto', '--host', '127.0.0.1', '--port', '9010']);
  });

  it('adds both VAD flags only when a VAD model is available', () => {
    const vad = '/custom/vad.bin';
    const result = plan(dependencies([binaries[1], modelPaths[0], vad], { WHISPER_VAD_MODEL_PATH: vad }));
    expect(result.args).toEqual(['-m', modelPaths[0], '-l', 'auto', '--host', '127.0.0.1', '--port', '8080', '--vad', '--vad-model', vad]);
  });

  it('continues without VAD when reading the optional model directory throws', () => {
    const deps = dependencies([binaries[1], modelPaths[0]]);
    deps.readDirectory = () => { throw new Error('unreadable'); };
    expect(plan(deps).vadModel).toBeNull();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('recognizes http://%s as local with default port 8080', (host) => {
    expect(resolveWhisperEndpoint(`http://${host}`)).toEqual({
      local: true, port: 8080, url: `http://${host}:8080/`, managedUrl: 'http://127.0.0.1:8080/',
    });
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('preserves explicit port 80 on %s', (host) => {
    expect(resolveWhisperEndpoint(`http://${host}:80/path?x=1#hash`)).toEqual({
      local: true, port: 80, url: `http://${host}/`, managedUrl: 'http://127.0.0.1:80/',
    });
  });

  it.each(['http://example.com:8080', 'http://192.168.1.2:8080', 'https://localhost:8080', 'https://127.0.0.1:8080', 'https://[::1]:8080', 'not a URL', 'http://localhost:0', 'http://localhost:65536'])('does not manage endpoint %j', (url) => {
    expect(resolveWhisperEndpoint(url).local).toBe(false);
  });

  it('does not inspect the filesystem for a nonlocal endpoint', () => {
    const deps = dependencies([]);
    deps.fileExists = vi.fn();
    deps.homedir = vi.fn();
    deps.readDirectory = vi.fn();
    expect(discoverWhisperServer('https://example.com', deps)).toEqual({ available: false, reason: 'server URL is not local' });
    expect(deps.fileExists).not.toHaveBeenCalled();
    expect(deps.homedir).not.toHaveBeenCalled();
    expect(deps.readDirectory).not.toHaveBeenCalled();
  });
});
