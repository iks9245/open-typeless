/**
 * ASR configuration loader.
 * Supports whisper.cpp (local) and Volcengine (cloud) backends.
 *
 * Backend selection:
 *   - Set WHISPER_SERVER_URL to use a local whisper.cpp server (default)
 *   - Set VOLCENGINE_APP_ID + VOLCENGINE_ACCESS_TOKEN to use Volcengine cloud
 *   - If WHISPER_SERVER_URL is unset, defaults to http://localhost:8080
 */

import { VOLCENGINE_CONSTANTS } from '../types';
import type { WhisperClientConfig } from './whisper-client';

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// ── Whisper config ────────────────────────────────────────────────────────────

export function loadWhisperConfig(): WhisperClientConfig {
  return {
    serverUrl: process.env.WHISPER_SERVER_URL ?? 'http://localhost:8080',
    language: process.env.WHISPER_LANGUAGE, // undefined = auto-detect
  };
}

// ── Volcengine config (kept for reference / optional fallback) ────────────────

export interface VolcengineEnvConfig {
  appId: string;
  accessToken: string;
  resourceId: string;
}

export function loadVolcengineConfig(): VolcengineEnvConfig {
  const appId = process.env.VOLCENGINE_APP_ID;
  const accessToken = process.env.VOLCENGINE_ACCESS_TOKEN;
  const resourceId =
    process.env.VOLCENGINE_RESOURCE_ID ?? VOLCENGINE_CONSTANTS.DEFAULT_RESOURCE_ID;

  const missing: string[] = [];
  if (!appId) missing.push('VOLCENGINE_APP_ID');
  if (!accessToken) missing.push('VOLCENGINE_ACCESS_TOKEN');
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return { appId: appId as string, accessToken: accessToken as string, resourceId };
}

// Keep the old name so existing call sites compile without change
export const loadASRConfig = loadVolcengineConfig;

export function isASRConfigured(): boolean {
  return Boolean(process.env.VOLCENGINE_APP_ID && process.env.VOLCENGINE_ACCESS_TOKEN);
}
