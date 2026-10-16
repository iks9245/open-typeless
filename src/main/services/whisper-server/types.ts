/**
 * Contracts for local whisper.cpp discovery, process ownership and lifecycle.
 */

import type { ChildProcess } from 'node:child_process';
import type { WhisperBinarySource } from '../../../shared/types/whisper-server';
import type { WhisperModelDependencies } from './lib/models';

export interface WhisperLaunchPlan {
  binary: string;
  binarySource: Exclude<WhisperBinarySource, null>;
  model: string;
  modelId: string | null;
  modelFallback: boolean;
  modelLocked: 'env' | null;
  vadModel: string | null;
  host: '127.0.0.1';
  port: number;
  args: string[];
}

export type WhisperDiscoveryResult =
  | { available: true; plan: WhisperLaunchPlan }
  | { available: false; reason: string; modelFallback?: boolean };

export type WhisperEndpoint =
  | { local: true; port: number; url: string; managedUrl: string }
  | { local: false; reason: string };

export interface WhisperDiscoveryInputs extends WhisperModelDependencies {
  env: Record<string, string | undefined>;
  bundledBinary: () => string | null;
  fileExists: (path: string) => boolean;
}

export interface WhisperPidRecord {
  pid: number;
  binary: string;
  port: number;
  startedAt: number;
}

export interface WhisperOwnershipDependencies {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  processAlive: (pid: number) => boolean;
  commandOf: (pid: number) => Promise<string>;
}

export interface WhisperServerStatus {
  mode: 'managed' | 'adopted' | 'external' | 'unavailable' | 'none';
  state: 'idle' | 'starting' | 'ready' | 'stopped' | 'failed';
  pid: number | null;
  binary: string | null;
  binarySource: WhisperBinarySource;
  model: string | null;
  vadModel: string | null;
  reason: string | null;
  modelId: string | null;
  modelFallback: boolean;
  modelLocked: 'env' | 'external' | null;
}

export interface WhisperServerDependencies {
  spawn: (binary: string, args: string[], options: { stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess;
  healthCheck: (url: string, signal: AbortSignal) => Promise<boolean>;
  timers: {
    setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  };
  now: () => number;
  discovery: WhisperDiscoveryInputs;
  ownership: WhisperOwnershipDependencies;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  pidFilePath: () => string;
  getServerUrl: () => string;
  getModel: () => string | null;
  logger: {
    debug: (message: string, details?: unknown) => void;
    info: (message: string, details?: unknown) => void;
    warn: (message: string, details?: unknown) => void;
    error: (message: string, details?: unknown) => void;
  };
}
