import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, runMigrations, transcriptions, historyEmbeddings, type NewTranscription } from '../../src/main/db';
import { MemoryIndexer } from '../../src/main/services/memory/indexer';
import { MemoryService } from '../../src/main/services/memory/memory.service';
import type { IndexerDependencies } from '../../src/main/services/memory/types';
import type { HistoryChange } from '../../src/shared/types/history';
import type { AppSettings } from '../../src/shared/types/settings';
import { getDefaultSettings } from '../../src/main/services/settings/types';
import { EMBEDDING_MODEL, MEMORY_QUERY_PREFIX } from '../../src/shared/constants/memory';

let connection: ReturnType<typeof openDatabase>;
let deps: IndexerDependencies;
let indexer: MemoryIndexer;
let service: MemoryService;
let settings: AppSettings;
let change: (change: HistoryChange) => void;
let settingsChanged: (settings: AppSettings) => void;
let sequence: number;
const json = (data: unknown) => new Response(JSON.stringify(data));
const bodies: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  connection = openDatabase(':memory:');
  runMigrations(connection.db, path.resolve(__dirname, '../../drizzle'));
  settings = getDefaultSettings({});
  sequence = 0;
  bodies.length = 0;
  deps = {
    getDb: () => connection.db, now: () => new Date(2026, 9, 15, 14).getTime(),
    readFile: async () => JSON.stringify({ server: { port: 1234 }, auth: { api_key: 'private-key' } }),
    env: {}, homedir: () => '/unused', logger: { debug: vi.fn(), warn: vi.fn() },
    fetch: vi.fn(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (String(url).endsWith('/embeddings')) {
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        return json({ data: inputs.map((text: string, index: number) => ({ index, embedding: text.includes('Ken') ? [1, 0] : [0, 1] })) });
      }
      return json({ choices: [{ message: { content: '<think>private</think>報價是五萬元。[1]' } }] });
    }),
    timers: { setTimeout, clearTimeout }, getSettings: () => ({ success: true, data: settings }),
    settingsService: { on: vi.fn((_event, listener) => { settingsChanged = listener; return deps.settingsService as never; }), off: vi.fn() },
    subscribeHistory: listener => { change = listener; return vi.fn(); },
  };
  indexer = new MemoryIndexer(deps);
  service = new MemoryService(deps, indexer);
});
afterEach(() => { indexer.stop(); connection.sqlite.close(); vi.useRealTimers(); });
function seed(extra: Partial<NewTranscription> = {}): string {
  const id = `row-${++sequence}`;
  connection.db.insert(transcriptions).values({ id, createdAt: deps.now() - 1000, updatedAt: deps.now(),
    status: 'completed', engine: 'whisper.cpp', appVersion: '1.0', finalText: 'Ken 報價五萬元', ...extra }).run();
  return id;
}
const vectors = () => connection.db.select().from(historyEmbeddings).all();
async function start() { indexer.start(); await vi.advanceTimersByTimeAsync(0); }

describe('memory indexer with real SQLite', () => {
  it('indexes only completed dictations with final text, batches by 32, skips unchanged hashes', async () => {
    for (let i = 0; i < 34; i++) seed();
    seed({ finalText: '😀'.repeat(601) });
    seed({ mode: 'command' }); seed({ status: 'processing' }); seed({ status: 'failed' }); seed({ finalText: '  ' });
    await start();
    expect(vectors()).toHaveLength(36);
    expect(bodies.map(body => (body.input as string[]).length)).toEqual([32, 4]);
    expect(bodies[0].model).toBe(EMBEDDING_MODEL);
    expect(indexer.status()).toEqual({ enabled: true, state: 'idle', reason: null, indexed: 35, total: 35 });
    const first = vectors()[0];
    await indexer.run();
    expect(bodies).toHaveLength(2);
    expect(vectors()[0]).toEqual(first);
  });
  it('replaces other models and changed text, invalidates its cache, debounces 2s', async () => {
    const id = seed(); await start();
    expect(indexer.chunks()[0].text).toContain('Ken');
    connection.db.update(historyEmbeddings).set({ model: 'old-model' }).run();
    await indexer.run();
    expect(bodies).toHaveLength(2);
    expect(vectors()[0].model).toBe(EMBEDDING_MODEL);
    connection.db.update(transcriptions).set({ finalText: 'different text' }).where(eq(transcriptions.id, id)).run();
    change({ id, kind: 'updated' }); change({ id, kind: 'updated' });
    expect(indexer.chunks()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1999);
    expect(bodies).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(bodies).toHaveLength(3);
    expect(indexer.chunks()[0].text).toBe('different text');
  });
  it('pauses, exponentially backs off to 10 minutes and recovers', async () => {
    seed();
    const fetch = deps.fetch;
    deps.fetch = vi.fn(async () => { throw new Error('private record text'); });
    const timer = vi.spyOn(deps.timers, 'setTimeout');
    await start();
    expect(indexer.status()).toMatchObject({ state: 'paused', indexed: 0 });
    change({ kind: 'updated', id: null });
    expect(timer.mock.calls.at(-1)?.[1]).toBe(30000);
    for (const delay of [30000, 60000, 120000, 240000, 480000, 600000]) {
      expect(timer.mock.calls.at(-1)?.[1]).toBe(delay);
      await vi.advanceTimersByTimeAsync(delay);
    }
    deps.fetch = fetch;
    await vi.advanceTimersByTimeAsync(600000);
    expect(indexer.status()).toMatchObject({ state: 'idle', indexed: 1 });
    expect(JSON.stringify(vi.mocked(deps.logger.warn).mock.calls)).not.toContain('private record text');
  });
  it('disabling clears every model, enabling backfills, rebuild clears and reindexes', async () => {
    seed(); await start();
    settings.memory.enabled = false; settingsChanged(settings);
    expect(vectors()).toEqual([]);
    expect(indexer.status()).toMatchObject({ state: 'disabled', enabled: false });
    await vi.advanceTimersByTimeAsync(1000000);
    expect(bodies).toHaveLength(1);
    settings.memory.enabled = true; settingsChanged(settings);
    await vi.advanceTimersByTimeAsync(0);
    expect(vectors()).toHaveLength(1);
    service.reindex();
    expect(vectors()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(vectors()).toHaveLength(1);
  });
  it('cascades on source delete and invalidates the retrieval cache', async () => {
    const id = seed(); await start();
    expect(indexer.chunks()).toHaveLength(1);
    connection.db.delete(transcriptions).where(eq(transcriptions.id, id)).run();
    change({ kind: 'deleted', id });
    expect(vectors()).toEqual([]);
    expect(indexer.chunks()).toEqual([]);
  });
  it.each(['delete', 'disable', 'rebuild', 'stop', 'edit'])('rejects an in-flight stale batch after %s', async action => {
    const id = seed();
    let resolve: (response: Response) => void = () => undefined;
    deps.fetch = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    indexer.start();
    const running = indexer.run();
    await Promise.resolve(); await Promise.resolve();
    if (action === 'delete') connection.db.delete(transcriptions).run();
    if (action === 'disable') { settings.memory.enabled = false; settingsChanged(settings); }
    if (action === 'rebuild') indexer.reindex();
    if (action === 'stop') indexer.stop();
    if (action === 'edit') connection.db.update(transcriptions).set({ finalText: 'new text' }).where(eq(transcriptions.id, id)).run();
    resolve(json({ data: [{ index: 0, embedding: [1, 0] }] }));
    await running;
    expect(vectors()).toEqual([]);
  });
});

describe('private memory asks through fake oMLX', () => {
  it('retrieves, uses command model, safe prompt/budgets/citations, emits and keeps only in-memory history', async () => {
    seed(); seed({ finalText: 'unrelated' }); await start();
    settings.command.model = 'my-command';
    const timer = vi.spyOn(deps.timers, 'setTimeout');
    const answered = vi.fn(); service.onAnswered(answered);
    const result = await service.ask({ question: 'Ken 的報價？' });
    expect(result).toMatchObject({ success: true, data: { answer: '報價是五萬元。[1]', sources: [{ n: 1, cited: true, snippet: 'Ken 報價五萬元' }] } });
    expect(bodies.at(-2)?.input).toBe(MEMORY_QUERY_PREFIX + 'Ken 的報價？');
    expect(bodies.at(-1)).toMatchObject({ model: 'my-command', max_tokens: 400, temperature: 0, chat_template_kwargs: { enable_thinking: false } });
    expect(timer.mock.calls.map(call => call[1])).toEqual([10000, 60000]);
    expect(answered).toHaveBeenCalledOnce();
    expect(service.history()[0].question).toBe('Ken 的報價？');
    expect(connection.db.select().from(transcriptions).all()).toHaveLength(2);
    for (let i = 0; i < 21; i++) await service.ask(`Ken ${i}`);
    expect(service.history()).toHaveLength(20);
    const copy = service.history(); copy[0].answer = 'changed';
    expect(service.history()[0].answer).not.toBe('changed');
  });
  it('short-circuits the LLM with no match and applies time filtering', async () => {
    seed({ createdAt: new Date(2026, 8, 1).getTime() }); await start();
    const before = bodies.length;
    expect(await service.ask('今天 Ken 報價？')).toEqual({ success: true, data: { answer: '紀錄裡找不到相關內容。', sources: [] } });
    expect(bodies).toHaveLength(before + 1);
    expect(String(bodies.at(-1)?.input)).toContain('Query: ');
  });
  it('rejects invalid input and disabled memory without requests', async () => {
    for (const input of ['', ' ', 'x'.repeat(501), {}, { question: 'Ken', extra: true }]) expect((await service.ask(input)).success).toBe(false);
    settings.memory.enabled = false;
    expect(await service.ask('Ken')).toEqual({ success: false, error: 'Memory is disabled' });
    expect(bodies).toHaveLength(0);
  });
  it.each([401, 500])('filters HTTP %s responses', async status => {
    deps.fetch = async () => new Response('private response', { status });
    expect(await service.ask('Ken')).toEqual({ success: false, error: `oMLX responded with HTTP ${status}` });
  });
  it('filters arbitrary failures and malformed embeddings without leaking content or keys', async () => {
    deps.fetch = async () => { throw new Error('private-key Ken 報價'); };
    expect(await service.ask('Ken')).toEqual({ success: false, error: 'oMLX request failed' });
    deps.fetch = async () => json({ data: [{ index: 1, embedding: [1, 0] }] });
    expect(await service.ask('Ken')).toEqual({ success: false, error: 'Invalid oMLX embeddings response' });
    deps.fetch = async () => json({ data: [{ index: 0, embedding: [0, 0] }] });
    expect(await service.ask('Ken')).toEqual({ success: false, error: 'Invalid oMLX embeddings response' });
    expect(JSON.stringify(vi.mocked(deps.logger.warn).mock.calls)).not.toMatch(/private-key|Ken/);
    expect(service.history()).toEqual([]);
  });
  it('times out and aborts a hung embedding request', async () => {
    let signal: AbortSignal | null | undefined;
    deps.fetch = async (_url, init) => { signal = init?.signal; return new Promise(() => undefined); };
    const asking = service.ask('Ken');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await asking).toEqual({ success: false, error: 'oMLX request timed out' });
    expect(signal?.aborted).toBe(true);
  });
});
