/**
 * Pure, injectable discovery of local whisper.cpp binaries and model files.
 */

import path from 'node:path';
import type { WhisperBinarySource } from '../../../../shared/types/whisper-server';
import type { WhisperDiscoveryInputs, WhisperDiscoveryResult, WhisperEndpoint } from '../types';
import { isWhisperModel, modelIdForPath, modelPath } from './models';

function binaryCandidates(deps: WhisperDiscoveryInputs): { binary: string | null | undefined; source: Exclude<WhisperBinarySource, null> }[] {
  return [
    { binary: deps.env.WHISPER_SERVER_BIN, source: 'env' },
    { binary: deps.bundledBinary(), source: 'bundled' },
    { binary: path.join(deps.homedir(), 'whisper.cpp', 'build', 'bin', 'whisper-server'), source: 'whisper.cpp' },
    { binary: '/opt/homebrew/bin/whisper-server', source: 'homebrew' },
    { binary: '/usr/local/bin/whisper-server', source: 'system' },
  ];
}

/** Classify the actual adopted executable, which can differ from today's preferred binary. */
export function binarySourceForPath(binary: string, deps: WhisperDiscoveryInputs): WhisperBinarySource {
  return binaryCandidates(deps).find(candidate => candidate.binary && path.resolve(candidate.binary) === path.resolve(binary))?.source ?? null;
}

export function resolveWhisperEndpoint(serverUrl: string): WhisperEndpoint {
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
      return { local: false, reason: 'server URL is not local' };
    }
    // URL.port omits an explicit HTTP port 80, so read the original authority too.
    const authority = serverUrl.trim().match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1].split('@').pop() ?? '';
    const explicitPort = authority.match(/:(\d+)$/)?.[1];
    const port = Number(explicitPort ?? (url.port || '8080'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { local: false, reason: 'invalid server URL port' };
    }
    url.port = String(port);
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return { local: true, port, url: url.toString(), managedUrl: `http://127.0.0.1:${port}/` };
  } catch {
    return { local: false, reason: 'server URL is not local' };
  }
}

export function discoverWhisperServer(serverUrl: string, deps: WhisperDiscoveryInputs, selectedModel: string | null = null): WhisperDiscoveryResult {
  const endpoint = resolveWhisperEndpoint(serverUrl);
  if (endpoint.local === false) return { available: false, reason: endpoint.reason };

  const home = deps.homedir();
  const models = path.join(home, 'whisper.cpp', 'models');
  const firstExisting = (candidates: (string | undefined)[]): string | undefined =>
    candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0 && deps.fileExists(candidate));
  const candidate = binaryCandidates(deps).find(({ binary }) => binary && deps.fileExists(binary));
  if (!candidate?.binary) return { available: false, reason: 'whisper-server binary not found' };
  const { binary, source: binarySource } = candidate;

  const envModel = firstExisting([deps.env.WHISPER_MODEL_PATH]);
  const selectedPath = selectedModel === null ? null : modelPath(selectedModel, deps);
  const selected = selectedPath !== null && isWhisperModel(selectedPath, deps) ? selectedPath : null;
  const modelFallback = envModel === undefined && selectedModel !== null && selected === null;
  const model = envModel ?? selected ?? firstExisting([
    ...['large-v3-turbo', 'large-v3', 'medium', 'small', 'base'].map(name => path.join(models, `ggml-${name}.bin`)),
  ]);
  if (!model) return {
    available: false, reason: 'no ggml model found',
    ...(modelFallback ? { modelFallback: true } : {}),
  };

  const configuredVad = deps.env.WHISPER_VAD_MODEL_PATH;
  let vadModel = firstExisting([
    configuredVad && !path.basename(configuredVad).startsWith('for-tests-') ? configuredVad : undefined,
  ]) ?? null;
  if (vadModel === null) {
    // Missing/unreadable model directories do not make optional VAD mandatory.
    let names: string[] = [];
    try { names = deps.readDirectory(models); } catch { /* Optional model directory. */ }
    vadModel = firstExisting(names
      .filter(name => !name.startsWith('for-tests-') && /^ggml-silero-.*\.bin$/.test(name)).sort()
      .map(name => path.join(models, name))) ?? null;
  }
  const args = ['-m', model, '-l', 'auto', '--host', '127.0.0.1', '--port', String(endpoint.port)];
  if (vadModel !== null) args.push('--vad', '--vad-model', vadModel);
  return { available: true, plan: {
    binary, binarySource, model, modelId: modelIdForPath(model, deps), modelFallback,
    modelLocked: deps.env.WHISPER_MODEL_PATH ? 'env' : null,
    vadModel, host: '127.0.0.1', port: endpoint.port, args,
  } };
}
