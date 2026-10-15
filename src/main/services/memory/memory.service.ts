import { randomUUID } from 'node:crypto';
import type { IpcResult } from '../../../shared/types/common';
import type { AskEntry, AskResult, MemoryStatus } from '../../../shared/types/memory';
import { EMBEDDING_MODEL, MEMORY_QUERY_PREFIX } from '../../../shared/constants/memory';
import { createCompletion, createEmbeddings, OmlxHttpError } from '../polish/lib/omlx-client';
import { readOmlxConfig } from '../polish/lib/omlx-config';
import { withOmlxTimeout } from '../polish/lib/timeout';
import { stripThinking, stripWrappingQuotes } from '../polish/lib/sanitize';
import { askInputSchema, type MemoryDependencies } from './types';
import type { MemoryIndexer } from './indexer';
import { rankChunks } from './lib/rank';
import { parseTimeRange } from './lib/time-range';
import { askSources, buildAskMessages } from './lib/prompt';

export class MemoryService {
  private entries: AskEntry[] = [];
  private readonly listeners = new Set<(entry: AskEntry) => void>();
  constructor(private readonly deps: MemoryDependencies, private readonly indexer: MemoryIndexer) {}

  status(): MemoryStatus { return this.indexer.status(); }
  history(): AskEntry[] { return structuredClone(this.entries); }
  reindex(): IpcResult<void> {
    try { this.indexer.reindex(); return { success: true, data: undefined }; }
    catch { return { success: false, error: 'Memory storage is unavailable' }; }
  }
  onAnswered(listener: (entry: AskEntry) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async ask(input: unknown): Promise<IpcResult<AskResult>> {
    // Both typed and spoken questions pass through the same validation.
    const parsed = askInputSchema.safeParse(typeof input === 'string' ? { question: input } : input);
    if (parsed.success === false) return { success: false, error: 'Question must be 1–500 characters' };
    const question = parsed.data.question;
    try {
      const settings = this.deps.getSettings();
      if (settings.success === false) return { success: false, error: 'Settings are unavailable' };
      if (!settings.data.memory.enabled) return { success: false, error: 'Memory is disabled' };
      const vector = await withOmlxTimeout(this.deps.timers, 10000, async signal => {
        const config = await readOmlxConfig(this.deps);
        if (!config) throw new Error('oMLX not installed');
        return (await createEmbeddings(config, { model: EMBEDDING_MODEL, input: MEMORY_QUERY_PREFIX + question }, this.deps.fetch, signal))[0];
      });
      const records = rankChunks(question, vector, this.indexer.chunks(), parseTimeRange(question, this.deps.now()));
      let answer = '紀錄裡找不到相關內容。';
      if (records.length) {
        const output = await withOmlxTimeout(this.deps.timers, 60000, async signal => {
          const config = await readOmlxConfig(this.deps);
          if (!config) throw new Error('oMLX not installed');
          return createCompletion(config, { model: settings.data.command.model,
            messages: buildAskMessages(question, records, this.deps.now()), maxTokens: 400 }, this.deps.fetch, signal);
        });
        answer = stripWrappingQuotes(stripThinking(output).trim());
        if (!answer) throw new Error('Empty command output');
      }
      const current = this.deps.getSettings();
      if (current.success === false || !current.data.memory.enabled) return { success: false, error: 'Memory is disabled' };
      const result: AskResult = { answer, sources: askSources(records, answer) };
      const entry: AskEntry = { ...result, id: randomUUID(), question, createdAt: this.deps.now() };
      this.entries = [entry, ...this.entries].slice(0, 20);
      for (const listener of this.listeners) {
        try { listener(structuredClone(entry)); } catch { this.deps.logger.warn('Ask answer listener failed'); }
      }
      return { success: true, data: result };
    } catch (error) {
      const known = ['oMLX not installed', 'oMLX request timed out', 'Empty command output',
        'Invalid oMLX JSON response', 'Invalid oMLX completion response', 'Invalid oMLX embeddings response'];
      const message = error instanceof OmlxHttpError ? error.message
        : error instanceof Error && known.includes(error.message) ? error.message : 'oMLX request failed';
      this.deps.logger.warn('Memory ask request failed');
      return { success: false, error: message };
    }
  }
}
