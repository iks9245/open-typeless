/**
 * Pure, injectable discovery of local whisper.cpp binaries and model files.
 */

import path from 'node:path';
import type { WhisperDiscoveryInputs, WhisperDiscoveryResult, WhisperEndpoint } from '../types';

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

export function discoverWhisperServer(serverUrl: string, deps: WhisperDiscoveryInputs): WhisperDiscoveryResult {
  const endpoint = resolveWhisperEndpoint(serverUrl);
  if (endpoint.local === false) return { available: false, reason: endpoint.reason };

  const home = deps.homedir();
  const models = path.join(home, 'whisper.cpp', 'models');
  const firstExisting = (candidates: (string | undefined)[]): string | undefined =>
    candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0 && deps.fileExists(candidate));
  const binary = firstExisting([
    deps.env.WHISPER_SERVER_BIN,
    path.join(home, 'whisper.cpp', 'build', 'bin', 'whisper-server'),
    '/opt/homebrew/bin/whisper-server',
    '/usr/local/bin/whisper-server',
  ]);
  if (!binary) return { available: false, reason: 'whisper-server binary not found' };

  const model = firstExisting([
    deps.env.WHISPER_MODEL_PATH,
    ...['large-v3-turbo', 'large-v3', 'medium', 'small', 'base'].map(name => path.join(models, `ggml-${name}.bin`)),
  ]);
  if (!model) return { available: false, reason: 'no ggml model found' };

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
  return { available: true, plan: { binary, model, vadModel, host: '127.0.0.1', port: endpoint.port, args } };
}
