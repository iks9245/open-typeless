/**
 * Contracts for local whisper.cpp discovery, process ownership and lifecycle.
 */

import type { ChildProcess } from 'node:child_process';

export interface WhisperLaunchPlan {
  binary: string;
  model: string;
  vadModel: string | null;
  host: '127.0.0.1';
  port: number;
  args: string[];
}

export type WhisperDiscoveryResult =
  | { available: true; plan: WhisperLaunchPlan }
  | { available: false; reason: string };

export type WhisperEndpoint =
  | { local: true; port: number; url: string; managedUrl: string }
  | { local: false; reason: string };

export interface WhisperDiscoveryInputs {
  env: Record<string, string | undefined>;
  homedir: () => string;
  fileExists: (path: string) => boolean;
  readDirectory: (path: string) => string[];
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
  model: string | null;
  vadModel: string | null;
  reason: string | null;
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
  logger: {
    debug: (message: string, details?: unknown) => void;
    info: (message: string, details?: unknown) => void;
    warn: (message: string, details?: unknown) => void;
    error: (message: string, details?: unknown) => void;
  };
}
