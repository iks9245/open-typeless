import { describe, expect, it } from 'vitest';
import { toWhisperServerInfo } from '../../src/main/ipc/whisper-server.handler';

describe('toWhisperServerInfo', () => {
  it('exposes file names but never full paths or the process ID', () => {
    const info = toWhisperServerInfo({
      mode: 'managed',
      state: 'ready',
      pid: 4242,
      binary: '/Users/someone/whisper.cpp/build/bin/whisper-server',
      model: '/Users/someone/whisper.cpp/models/ggml-large-v3-turbo.bin',
      vadModel: '/Users/someone/whisper.cpp/models/ggml-silero-v6.2.0.bin',
      reason: null,
    });

    expect(info).toEqual({
      mode: 'managed',
      state: 'ready',
      reason: null,
      binaryName: 'whisper-server',
      modelName: 'ggml-large-v3-turbo.bin',
      vadModelName: 'ggml-silero-v6.2.0.bin',
    });
    expect(JSON.stringify(info)).not.toContain('/Users/');
    expect(info).not.toHaveProperty('pid');
  });

  it('keeps unknown files as null', () => {
    expect(toWhisperServerInfo({
      mode: 'unavailable', state: 'failed', pid: null, binary: null, model: null, vadModel: null,
      reason: 'whisper-server binary not found',
    })).toMatchObject({ binaryName: null, modelName: null, vadModelName: null, reason: 'whisper-server binary not found' });
  });
});
