import type { PolishDependencies } from '../polish/types';

export interface CommandOutcome {
  text: string;
  latencyMs: number;
  error: string | null;
}

export type CommandDependencies = Pick<PolishDependencies,
  'readFile' | 'env' | 'homedir' | 'logger' | 'fetch' | 'now' | 'timers'> & {
  captureSelection(): Promise<string | null>;
};
