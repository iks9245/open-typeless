import { describe, expect, it, vi } from 'vitest';
import { isWhisperModel, listModels, modelPath, WHISPER_MODEL_ID_PATTERN, type WhisperModelDependencies } from '../../src/main/services/whisper-server/lib/models';

function dependencies(): WhisperModelDependencies {
  return {
    homedir: () => '/home', userData: () => '/app',
    readDirectory: vi.fn(directory => directory === '/app/models'
      ? ['z.bin', 'bad.bin', 'short.bin', 'for-tests-a.bin', 'ggml-silero-a.bin', 'a.bin', 'encoder-encoder.mlmodelc', 'directory.bin', 'a.txt', 'denied.bin']
      : ['b.bin', 'a.bin']),
    statFile: file => {
      if (file.endsWith('denied.bin')) throw new Error('denied');
      return { isFile: () => !file.endsWith('directory.bin'), size: file.endsWith('/z.bin') ? 42 : 100 };
    },
    readHeader: file => Buffer.from(file.endsWith('bad.bin') ? 'ggml' : file.endsWith('short.bin') ? 'lmg' : 'lmgg'),
  };
}

describe('whisper model catalog', () => {
  it('checks little-endian magic, excludes tests, VAD and directories, sorts sources then names and includes sizes', () => {
    expect(listModels(dependencies())).toEqual([
      { id: 'app/a.bin', source: 'app', fileName: 'a.bin', sizeBytes: 100 },
      { id: 'app/z.bin', source: 'app', fileName: 'z.bin', sizeBytes: 42 },
      { id: 'whisper.cpp/a.bin', source: 'whisper.cpp', fileName: 'a.bin', sizeBytes: 100 },
      { id: 'whisper.cpp/b.bin', source: 'whisper.cpp', fileName: 'b.bin', sizeBytes: 100 },
    ]);
    expect(JSON.stringify(listModels(dependencies()))).not.toMatch(/\/home|\/app/);
  });

  it.each(['/app/models', '/home/whisper.cpp/models'])('skips unreadable directory %s', directory => {
    const deps = dependencies();
    const read = deps.readDirectory;
    deps.readDirectory = candidate => {
      if (candidate === directory) throw new Error('denied');
      return read(candidate);
    };
    expect(listModels(deps).every(model => model.source === (directory === '/app/models' ? 'whisper.cpp' : 'app'))).toBe(true);
    expect(listModels(deps)).toHaveLength(2);
  });

  it('skips unreadable headers', () => {
    const deps = dependencies();
    deps.readHeader = () => { throw new Error('unreadable'); };
    expect(listModels(deps)).toEqual([]);
    expect(isWhisperModel('/app/models/a.bin', deps)).toBe(false);
  });

  it('skips files which disappear between validation and reading their size', () => {
    const deps = dependencies();
    deps.readDirectory = () => ['a.bin'];
    let calls = 0;
    deps.statFile = () => {
      if (++calls % 2 === 0) throw new Error('disappeared');
      return { isFile: () => true, size: 100 };
    };
    expect(listModels(deps)).toEqual([]);
  });

  it.each(['app/a.bin', 'whisper.cpp/a b.bin', 'app/ggml-large-v3-cantonese-q8_0.bin'])('resolves valid id %j', id => {
    expect(WHISPER_MODEL_ID_PATTERN.test(id)).toBe(true);
    expect(modelPath(id, dependencies())).not.toBeNull();
  });

  it.each(['a.bin', '/app/a.bin', 'app/../a.bin', 'app/a\\b.bin', 'app/a.txt', 'other/a.bin', 'whisperXcpp/a.bin'])('rejects invalid id %j', id => {
    expect(WHISPER_MODEL_ID_PATTERN.test(id)).toBe(false);
    expect(modelPath(id, dependencies())).toBeNull();
  });
});
