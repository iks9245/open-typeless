import { describe, expect, it } from 'vitest';
import { toWhisperServerInfo } from '../../src/main/ipc/whisper-server.handler';

describe('toWhisperServerInfo', () => {
  it('exposes file names but never full paths or the process ID', () => {
    const info = toWhisperServerInfo({
      modelId: 'whisper.cpp/ggml-large-v3-turbo.bin', modelFallback: false, modelLocked: null,
      mode: 'managed',
      state: 'ready',
      pid: 4242,
      binary: '/Users/someone/whisper.cpp/build/bin/whisper-server',
      binarySource: 'whisper.cpp',
      model: '/Users/someone/whisper.cpp/models/ggml-large-v3-turbo.bin',
      vadModel: '/Users/someone/whisper.cpp/models/ggml-silero-v6.2.0.bin',
      reason: null,
    });

    expect(info).toEqual({
      modelId: 'whisper.cpp/ggml-large-v3-turbo.bin', modelFallback: false, modelLocked: null,
      mode: 'managed',
      state: 'ready',
      reason: null,
      binaryName: 'whisper-server',
      binarySource: 'whisper.cpp',
      modelName: 'ggml-large-v3-turbo.bin',
      vadModelName: 'ggml-silero-v6.2.0.bin',
    });
    expect(JSON.stringify(info)).not.toContain('/Users/');
    expect(info).not.toHaveProperty('pid');
  });

  it('keeps unknown files as null', () => {
    expect(toWhisperServerInfo({
      modelId: null, modelFallback: true, modelLocked: null,
      mode: 'unavailable', state: 'failed', pid: null, binary: null, model: null, vadModel: null,
      binarySource: null,
      reason: 'whisper-server binary not found',
    })).toMatchObject({ binaryName: null, binarySource: null, modelName: null, vadModelName: null, reason: 'whisper-server binary not found' });
  });

  it.each(['env', 'bundled', 'whisper.cpp', 'homebrew', 'system', null] as const)('passes through binary source %s without exposing its path', binarySource => {
    const info = toWhisperServerInfo({
      mode: 'adopted', state: 'ready', pid: 42, binary: '/private/app/Contents/Resources/whisper-server',
      binarySource, model: null, vadModel: null, reason: null,
      modelId: null, modelFallback: false, modelLocked: null,
    });
    expect(info).toMatchObject({ binaryName: 'whisper-server', binarySource });
    expect(JSON.stringify(info)).not.toContain('/private/');
    expect(info).not.toHaveProperty('pid');
  });
});
