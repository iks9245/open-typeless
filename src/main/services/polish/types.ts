import type { AppSettings } from '../../../shared/types/settings';
import type { SettingsResult, SettingsService } from '../settings/types';

export interface OmlxConfig {
  baseUrl: string;
  apiKey: string | null;
}

export interface PolishOutcome {
  text: string;
  polished: boolean;
  latencyMs: number;
  error: string | null;
}

export interface PolishConfigDependencies {
  readFile: (file: string) => Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  homedir: () => string;
  logger: {
    debug: (message: string) => void;
    warn: (message: string) => void;
  };
}

export interface PolishDependencies extends PolishConfigDependencies {
  fetch: typeof globalThis.fetch;
  now: () => number;
  timers: {
    setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  };
  getSettings: () => SettingsResult<AppSettings>;
  settingsService: Pick<SettingsService, 'on' | 'off'>;
}

export interface PolishMessage {
  role: 'system' | 'user';
  content: string;
}
