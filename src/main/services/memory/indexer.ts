import { and, eq } from 'drizzle-orm';
// uuid 13 exposes package exports that the legacy ESLint resolver cannot resolve.
// eslint-disable-next-line import/no-unresolved
import { v7 as uuidv7 } from 'uuid';
import { historyEmbeddings, transcriptions } from '../../db/schema';
import type { MemoryStatus } from '../../../shared/types/memory';
import { EMBEDDING_MODEL } from '../../../shared/constants/memory';
import { createEmbeddings } from '../polish/lib/omlx-client';
import { readOmlxConfig } from '../polish/lib/omlx-config';
import { withOmlxTimeout } from '../polish/lib/timeout';
import { chunkText, textHash } from './lib/chunk';
import { decodeVector, encodeVector } from './lib/vector';
import type { MemoryChunk } from './lib/rank';
import type { IndexerDependencies } from './types';

export class MemoryIndexer {
  private started = false;
  private enabled = false;
  private generation = 0;
  private state: MemoryStatus['state'] = 'idle';
  private reason: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 30000;
  private running = false;
  private requested = false;
  private controller: AbortController | null = null;
  private unsubscribe: (() => void) | null = null;
  private cache: MemoryChunk[] | null = null;
  private readonly onSettings = (): void => {
    const settings = this.deps.getSettings();
    if (settings.success === false) return;
    const enabled = settings.data.memory.enabled;
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.cancel();
    this.retryMs = 30000;
    if (enabled) { this.state = 'idle'; this.reason = null; this.schedule(0); }
    else this.clearDisabled();
  };

  constructor(private readonly deps: IndexerDependencies) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.deps.subscribeHistory(change => {
      this.invalidate();
      // Any pending result must be checked against current source text before writing.
      if (change.kind === 'updated' && this.state !== 'paused') this.schedule(2000);
    });
    this.deps.settingsService.on('changed', this.onSettings);
    const settings = this.deps.getSettings();
    this.enabled = settings.success === true && settings.data.memory.enabled;
    if (this.enabled) this.schedule(0);
    else this.clearDisabled();
  }

  stop(): void {
    this.started = false;
    this.cancel();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.deps.settingsService.off('changed', this.onSettings);
    this.invalidate();
  }

  private cancel(): void {
    this.generation++;
    this.controller?.abort();
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
    this.requested = false;
    this.invalidate();
  }

  private clearDisabled(): void {
    this.state = 'disabled';
    this.reason = null;
    try { this.deps.getDb().delete(historyEmbeddings).run(); }
    catch { this.deps.logger.warn('Memory storage unavailable'); }
  }

  invalidate(): void { this.cache = null; }

  private rows() {
    return this.deps.getDb().select().from(transcriptions).where(and(
      eq(transcriptions.status, 'completed'), eq(transcriptions.mode, 'dictation'),
    )).all().filter(row => row.finalText?.trim());
  }

  /** Cached vectors are also checked against current source hashes after history changes. */
  chunks(): MemoryChunk[] {
    if (this.cache) return this.cache;
    const db = this.deps.getDb();
    const rows = new Map(this.rows().map(row => [row.id, row]));
    const texts = new Map([...rows.values()].map(row => [row.id, chunkText(row.finalText ?? '')]));
    this.cache = db.select().from(historyEmbeddings).where(eq(historyEmbeddings.model, EMBEDDING_MODEL)).all().flatMap(item => {
      const row = rows.get(item.transcriptionId);
      const text = texts.get(item.transcriptionId)?.[item.chunkIndex];
      if (!row || text === undefined || textHash(text) !== item.textHash || item.vector.length !== item.dim * 4) return [];
      return [{ transcriptionId: row.id, chunkIndex: item.chunkIndex, createdAt: row.createdAt, text, vector: decodeVector(item.vector) }];
    });
    return this.cache;
  }

  status(): MemoryStatus {
    try {
      const rows = this.rows();
      const counts = new Map<string, number>();
      for (const chunk of this.chunks()) counts.set(chunk.transcriptionId, (counts.get(chunk.transcriptionId) ?? 0) + 1);
      const indexed = rows.filter(row => counts.get(row.id) === chunkText(row.finalText ?? '').length).length;
      return { enabled: this.enabled, state: this.state, reason: this.reason, indexed, total: rows.length };
    } catch {
      return { enabled: this.enabled, state: this.enabled ? 'paused' : 'disabled', reason: 'Memory storage is unavailable', indexed: 0, total: 0 };
    }
  }

  reindex(): void {
    this.cancel();
    this.deps.getDb().delete(historyEmbeddings).run();
    this.retryMs = 30000;
    this.reason = null;
    this.state = this.enabled ? 'idle' : 'disabled';
    if (this.enabled) this.schedule(0);
  }

  private schedule(ms: number): void {
    if (!this.started || !this.enabled) return;
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = this.deps.timers.setTimeout(() => { this.timer = null; void this.run(); }, ms);
  }

  /** Public for deterministic tests; production runs only through the scheduler. */
  async run(): Promise<void> {
    if (!this.started || !this.enabled) return;
    if (this.running) { this.requested = true; return; }
    this.running = true;
    this.state = 'indexing';
    this.reason = null;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const db = this.deps.getDb();
      const rows = this.rows();
      const existing = db.select().from(historyEmbeddings).all();
      const wanted = rows.flatMap(row => chunkText(row.finalText ?? '').map((text, chunkIndex) => ({
        transcriptionId: row.id, chunkIndex, text, hash: textHash(text),
      })));
      const keys = new Map(wanted.map(chunk => [`${chunk.transcriptionId}:${chunk.chunkIndex}`, chunk]));
      const valid = new Set<string>();
      db.transaction(tx => {
        for (const item of existing) {
          const key = `${item.transcriptionId}:${item.chunkIndex}`;
          const chunk = keys.get(key);
          if (!valid.has(key) && chunk && item.model === EMBEDDING_MODEL && item.textHash === chunk.hash && item.vector.length === item.dim * 4) valid.add(key);
          else tx.delete(historyEmbeddings).where(eq(historyEmbeddings.id, item.id)).run();
        }
      });
      this.invalidate();
      const pending = wanted.filter(chunk => !valid.has(`${chunk.transcriptionId}:${chunk.chunkIndex}`));
      for (let offset = 0; offset < pending.length; offset += 32) {
        if (generation !== this.generation || !this.enabled || !this.started) return;
        const batch = pending.slice(offset, offset + 32);
        const vectors = await withOmlxTimeout(this.deps.timers, 10000, async signal => {
          const abort = () => controller.abort();
          signal.addEventListener('abort', abort, { once: true });
          try {
            const config = await readOmlxConfig(this.deps);
            if (!config) throw new Error('oMLX not installed');
            return await createEmbeddings(config, { model: EMBEDDING_MODEL, input: batch.map(chunk => chunk.text) },
              this.deps.fetch, controller.signal);
          } finally { signal.removeEventListener('abort', abort); }
        });
        if (generation !== this.generation || !this.enabled || !this.started) return;
        db.transaction(tx => {
          batch.forEach((chunk, i) => {
            const source = tx.select().from(transcriptions).where(eq(transcriptions.id, chunk.transcriptionId)).get();
            if (!source || source.status !== 'completed' || source.mode !== 'dictation' ||
              chunkText(source.finalText ?? '')[chunk.chunkIndex] !== chunk.text) return;
            tx.insert(historyEmbeddings).values({ id: uuidv7(), transcriptionId: chunk.transcriptionId,
              chunkIndex: chunk.chunkIndex, model: EMBEDDING_MODEL, dim: vectors[i].length,
              vector: encodeVector(vectors[i]), textHash: chunk.hash, createdAt: this.deps.now() }).run();
          });
        });
        this.invalidate();
      }
      this.retryMs = 30000;
      this.state = 'idle';
    } catch {
      if (generation !== this.generation) return;
      this.state = 'paused';
      this.reason = 'oMLX 未啟動';
      this.deps.logger.warn('Memory indexing paused');
      this.schedule(this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 600000);
    } finally {
      this.running = false;
      if (this.controller === controller) this.controller = null;
      if (this.requested) {
        this.requested = false;
        if (this.state !== 'paused') this.schedule(0);
      }
    }
  }
}
