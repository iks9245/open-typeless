/** Model catalog and selection helpers; all filesystem access is injected. */
import path from 'node:path';
import type { WhisperModelInfo } from '../../../../shared/types/whisper-server';

export interface WhisperModelDependencies {
  homedir: () => string;
  userData: () => string;
  readDirectory: (directory: string) => string[];
  statFile: (file: string) => { isFile: () => boolean; size: number };
  readHeader: (file: string) => Buffer;
}

export const WHISPER_MODEL_ID_PATTERN = /^(app|whisper\.cpp)\/[^/\\]+\.bin$/;

export function modelDirectory(source: WhisperModelInfo['source'], deps: Pick<WhisperModelDependencies, 'userData' | 'homedir'>): string {
  return source === 'app' ? path.join(deps.userData(), 'models') : path.join(deps.homedir(), 'whisper.cpp', 'models');
}

export function modelPath(id: string, deps: WhisperModelDependencies): string | null {
  if (!WHISPER_MODEL_ID_PATTERN.test(id)) return null;
  const [source, fileName] = id.split('/') as [WhisperModelInfo['source'], string];
  return path.join(modelDirectory(source, deps), fileName);
}

export function isWhisperModel(file: string, deps: WhisperModelDependencies): boolean {
  const name = path.basename(file);
  if (!name.endsWith('.bin') || name.startsWith('for-tests-') || name.startsWith('ggml-silero-')) return false;
  try {
    if (!deps.statFile(file).isFile()) return false;
    const header = deps.readHeader(file);
    return header.length >= 4 && header.readUInt32LE(0) === 0x67676d6c;
  } catch { return false; }
}

export function modelIdForPath(file: string, deps: WhisperModelDependencies): string | null {
  for (const source of ['app', 'whisper.cpp'] as const) {
    if (path.resolve(path.dirname(file)) === path.resolve(modelDirectory(source, deps))) {
      const id = `${source}/${path.basename(file)}`;
      if (WHISPER_MODEL_ID_PATTERN.test(id)) return id;
    }
  }
  return null;
}

export function listModels(deps: WhisperModelDependencies): WhisperModelInfo[] {
  const result: WhisperModelInfo[] = [];
  for (const source of ['app', 'whisper.cpp'] as const) {
    let names: string[];
    try { names = deps.readDirectory(modelDirectory(source, deps)); } catch { continue; }
    for (const fileName of names.sort()) {
      const id = `${source}/${fileName}`;
      const file = modelPath(id, deps);
      if (file === null || !isWhisperModel(file, deps)) continue;
      try { result.push({ id, source, fileName, sizeBytes: deps.statFile(file).size }); } catch { /* File disappeared. */ }
    }
  }
  return result;
}
