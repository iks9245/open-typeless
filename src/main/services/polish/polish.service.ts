import { withOmlxTimeout } from './lib/timeout';
import { warmOmlx } from './lib/warm-up';
import type { PolishInfo } from '../../../shared/types/polish';
import type { AppSettings } from '../../../shared/types/settings';
import { readOmlxConfig } from './lib/omlx-config';
import { createCompletion, listModels, OmlxHttpError } from './lib/omlx-client';
import { buildPolishMessages } from './lib/prompt';
import { acceptPolished } from './lib/sanitize';
import { toTraditional } from './lib/traditional';
import type { PolishDependencies, PolishOptions, PolishOutcome } from './types';

export class PolishService {
  private readonly warming = new Set<string>();
  private readonly warmedAt = new Map<string, number>();
  private warmupsStarted = false;
  private previous: AppSettings['polish'] | null = null;
  private readonly onSettingsChanged = (settings: AppSettings): void => {
    const next = settings.polish;
    if (next.enabled && (!this.previous?.enabled || next.model !== this.previous.model)) {
      this.warmUp(next.model);
    }
    this.previous = { ...next };
  };

  constructor(private readonly deps: PolishDependencies) {}

  async status(): Promise<PolishInfo> {
    try {
      return await this.withTimeout(3000, async (signal) => {
        const config = await readOmlxConfig(this.deps);
        if (!config) return { available: false, reason: 'not-installed', models: [] };
        return { available: true, reason: null, models: await listModels(config, this.deps.fetch, signal) };
      });
    } catch (error) {
      const unauthorized = error instanceof OmlxHttpError && (error.status === 401 || error.status === 403);
      return { available: false, reason: unauthorized ? 'unauthorized' : 'unreachable', models: [] };
    }
  }

  /** Best effort: callers always receive either accepted output or their original text. */
  async polish(text: string, options: PolishOptions): Promise<PolishOutcome> {
    const started = this.deps.now();
    const outcome = (finalText: string, polished: boolean, error: string | null): PolishOutcome => ({
      text: finalText, polished, latencyMs: this.deps.now() - started, error,
    });
    if (!text.trim()) return outcome(text, false, null);
    let apiKey: string | null = null;
    try {
      const codePoints = Array.from(text).length;
      const output = await this.withTimeout(Math.min(15000, 4000 + 25 * codePoints), async (signal) => {
        const config = await readOmlxConfig(this.deps);
        if (!config) throw new Error('oMLX not installed');
        apiKey = config.apiKey;
        return createCompletion(config, {
          model: options.model,
          messages: buildPolishMessages(text, options.vocabulary, options.style),
          maxTokens: Math.min(2048, codePoints * 2 + 64),
        }, this.deps.fetch, signal);
      });
      const accepted = acceptPolished(text, output);
      if (accepted.ok === false) throw new Error(`Rejected polish output: ${accepted.reason}`);
      return outcome(toTraditional(accepted.text), true, null);
    } catch (error) {
      let message = error instanceof Error ? error.message : 'oMLX request failed';
      if (apiKey) message = message.split(apiKey).join('[redacted]');
      this.deps.logger.warn(message);
      return outcome(text, false, message);
    }
  }

  warmUp(model: string): void {
    warmOmlx(this.deps, model, this.warming, this.warmedAt);
  }

  startWarmups(): void {
    if (this.warmupsStarted) return;
    this.warmupsStarted = true;
    this.deps.settingsService.on('changed', this.onSettingsChanged);
    const settings = this.deps.getSettings();
    if (settings.success === true) this.onSettingsChanged(settings.data);
  }

  dispose(): void {
    if (!this.warmupsStarted) return;
    this.deps.settingsService.off('changed', this.onSettingsChanged);
    this.warmupsStarted = false;
    this.previous = null;
  }

  private withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return withOmlxTimeout(this.deps.timers, ms, run);
  }
}
