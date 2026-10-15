import { readOmlxConfig } from '../polish/lib/omlx-config';
import { createCompletion, OmlxHttpError } from '../polish/lib/omlx-client';
import { stripThinking, stripWrappingQuotes } from '../polish/lib/sanitize';
import { withOmlxTimeout } from '../polish/lib/timeout';
import { warmOmlx } from '../polish/lib/warm-up';
import { buildCommandMessages, commandBudget } from './lib/prompt';
import type { CommandDependencies, CommandOutcome } from './types';

export class CommandService {
  private readonly warming = new Set<string>();
  private readonly warmedAt = new Map<string, number>();

  constructor(private readonly deps: CommandDependencies) {}

  captureSelection(): Promise<string | null> {
    return this.deps.captureSelection();
  }

  async run(instruction: string, selection: string | null, options: { model: string }): Promise<CommandOutcome> {
    const started = this.deps.now();
    try {
      const { maxTokens, timeoutMs } = commandBudget(selection);
      const output = await withOmlxTimeout(this.deps.timers, timeoutMs, async (signal) => {
        const config = await readOmlxConfig(this.deps);
        if (!config) throw new Error('oMLX not installed');
        return createCompletion(config, {
          model: options.model, messages: buildCommandMessages(instruction, selection), maxTokens,
        }, this.deps.fetch, signal);
      });
      const text = stripWrappingQuotes(stripThinking(output).replace(/<\/?(?:instruction|selection|transcript)>/gi, '').trim());
      if (!text) throw new Error('Empty command output');
      return { text, latencyMs: this.deps.now() - started, error: null };
    } catch (error) {
      // Never expose arbitrary fetch errors: they can contain request text or credentials.
      const known = ['oMLX not installed', 'oMLX request timed out', 'Empty command output',
        'Invalid oMLX JSON response', 'Invalid oMLX completion response'];
      const message = error instanceof OmlxHttpError ? error.message
        : error instanceof Error && known.includes(error.message) ? error.message : 'oMLX request failed';
      this.deps.logger.warn('Command request failed');
      return { text: '', latencyMs: this.deps.now() - started, error: message };
    }
  }

  warmUp(model: string): void {
    warmOmlx(this.deps, model, this.warming, this.warmedAt);
  }
}
