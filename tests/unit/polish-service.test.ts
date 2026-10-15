import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANTONESE_SYSTEM_PROMPT, SYSTEM_PROMPT } from '../../src/main/services/polish/lib/prompt';
import { PolishService } from '../../src/main/services/polish/polish.service';
import type { PolishDependencies } from '../../src/main/services/polish/types';
import { getDefaultSettings } from '../../src/main/services/settings/types';
import type { AppSettings } from '../../src/shared/types/settings';

const key = 'test-secret-key';
const options = { model: 'Qwen3.5-9B-4bit', vocabulary: ['Open Typeless'] };

function dependencies(): PolishDependencies {
  return {
    readFile: async () => JSON.stringify({ server: { port: 11123 }, auth: { api_key: key } }),
    env: {}, homedir: () => '/unused', fetch: globalThis.fetch, now: Date.now,
    timers: { setTimeout, clearTimeout }, logger: { warn: vi.fn(), debug: vi.fn() },
    getSettings: () => ({ success: true, data: getDefaultSettings({}) }),
    settingsService: { on: vi.fn(), off: vi.fn() },
  };
}

const completion = (content: string): Response => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

describe('polish service without sockets', () => {
  it.each(['standard', 'cantonese'] as const)('sends the %s prompt and keeps Traditional conversion', async style => {
    const deps = dependencies();
    deps.fetch = vi.fn(async () => completion('我哋将份文件攞過嚟。'));
    const result = await new PolishService(deps).polish('我們把那份文件拿過來', { ...options, vocabulary: [], style });
    expect(result).toMatchObject({ text: '我哋將份文件攞過嚟。', polished: true });
    const request = JSON.parse(String(vi.mocked(deps.fetch).mock.calls[0][1]?.body));
    expect(request.messages[0]).toEqual({
      role: 'system', content: style === 'cantonese' ? CANTONESE_SYSTEM_PROMPT : SYSTEM_PROMPT,
    });
  });

  it('returns whitespace unchanged without reading config or requesting anything', async () => {
    const deps = dependencies();
    deps.readFile = vi.fn();
    deps.fetch = vi.fn();
    expect(await new PolishService(deps).polish(' \n', options)).toMatchObject({ text: ' \n', polished: false, error: null });
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it('returns not-installed for a missing config and never throws from polish', async () => {
    const deps = dependencies();
    deps.readFile = async () => { throw new Error('missing'); };
    const service = new PolishService(deps);
    expect(await service.status()).toEqual({ available: false, reason: 'not-installed', models: [] });
    expect(await service.polish('hello', options)).toMatchObject({ text: 'hello', polished: false, error: 'oMLX not installed' });
  });

  it('measures latency, uses code point budgets and never logs text or keys', async () => {
    const deps = dependencies();
    deps.now = vi.fn().mockReturnValueOnce(10).mockReturnValue(35);
    deps.fetch = vi.fn(async () => completion('😀。'));
    const timer = vi.spyOn(deps.timers, 'setTimeout');
    const result = await new PolishService(deps).polish('😀', options);
    expect(result).toEqual({ text: '😀。', polished: true, error: null, latencyMs: 25 });
    expect(timer.mock.calls[0][1]).toBe(4025);
    const request = JSON.parse(String(vi.mocked(deps.fetch).mock.calls[0][1]?.body));
    expect(request.max_tokens).toBe(66);
    expect(deps.logger.warn).not.toHaveBeenCalled();
    deps.fetch = async () => { throw new Error(`failed ${key}`); };
    const failed = await new PolishService(deps).polish('private transcript', options);
    expect(failed.error).toBe('failed [redacted]');
    expect(deps.logger.warn).toHaveBeenCalledWith('failed [redacted]');
  });

  it('builds the authenticated non-thinking request and preserves transcript delimiters', async () => {
    const deps = dependencies();
    deps.fetch = vi.fn(async () => completion('你好，世界。'));
    const service = new PolishService(deps);
    expect(await service.polish('你好世界', options)).toMatchObject({ text: '你好，世界。', polished: true });
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11123/v1/chat/completions');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: options.model, temperature: 0, max_tokens: 72, stream: false,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: expect.stringContaining('以下詞彙請保持這個寫法：Open Typeless') },
        { role: 'user', content: '<transcript>你好世界</transcript>' }],
    });
    deps.readFile = async () => JSON.stringify({ server: { port: 11123 } });
    await service.polish('你好世界', options);
    expect(vi.mocked(deps.fetch).mock.calls[1][1]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('caps completion tokens and timeouts', async () => {
    const deps = dependencies();
    deps.fetch = vi.fn(async () => completion('a'.repeat(1000)));
    const timer = vi.spyOn(deps.timers, 'setTimeout');
    await new PolishService(deps).polish('a'.repeat(1000), options);
    expect(timer.mock.calls[0][1]).toBe(15000);
    expect(JSON.parse(String(vi.mocked(deps.fetch).mock.calls[0][1]?.body)).max_tokens).toBe(2048);
  });

  it.each([
    '{broken', JSON.stringify({}), JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{ message: { content: null } }] }),
  ])('falls back on malformed completion JSON %s', async (body) => {
    const deps = dependencies();
    deps.fetch = async () => new Response(body);
    expect(await new PolishService(deps).polish('hello', options)).toMatchObject({ text: 'hello', polished: false });
  });

  it('times out a pending request, aborts it and clears its timer', async () => {
    const deps = dependencies();
    let signal: AbortSignal | null | undefined;
    deps.fetch = async (_url, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => undefined);
    };
    deps.timers.setTimeout = callback => setTimeout(callback, 5);
    const clear = vi.spyOn(deps.timers, 'clearTimeout');
    const result = await new PolishService(deps).polish('private transcript', options);
    expect(result).toMatchObject({ text: 'private transcript', polished: false, error: 'oMLX request timed out' });
    expect((signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(deps.logger.warn).toHaveBeenCalledWith('oMLX request timed out');
  });

  it.each([401, 403, 500])('maps HTTP %s to the appropriate status without sockets', async (status) => {
    const deps = dependencies();
    deps.fetch = async () => new Response('error', { status });
    const service = new PolishService(deps);
    expect(await service.status()).toEqual({ available: false, reason: status === 500 ? 'unreachable' : 'unauthorized', models: [] });
    expect(await service.polish('hello', options)).toMatchObject({ text: 'hello', polished: false, error: `oMLX responded with HTTP ${status}` });
  });

  it('falls back on overlong and over-short outputs', async () => {
    const deps = dependencies();
    deps.fetch = async () => completion('a'.repeat(50));
    expect(await new PolishService(deps).polish('hello', options)).toMatchObject({ text: 'hello', polished: false, error: 'Rejected polish output: too long' });
    deps.fetch = async () => completion('a');
    expect(await new PolishService(deps).polish('a'.repeat(20), options)).toMatchObject({ text: 'a'.repeat(20), polished: false, error: 'Rejected polish output: too short' });
  });

  it('does not follow redirects or send Authorization without a key', async () => {
    const deps = dependencies();
    deps.readFile = async () => JSON.stringify({ server: { port: 11123 } });
    deps.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] })));
    expect(await new PolishService(deps).status()).toEqual({ available: true, reason: null, models: [] });
    expect(vi.mocked(deps.fetch).mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: {} });
  });

  it('rejects invalid models responses', async () => {
    const deps = dependencies();
    deps.fetch = async () => new Response(JSON.stringify({ data: [{ id: 123 }] }));
    expect(await new PolishService(deps).status()).toEqual({ available: false, reason: 'unreachable', models: [] });
  });

  it('warms enabled settings once, handles model/enabled transitions and unsubscribes', async () => {
    const deps = dependencies();
    let settings = getDefaultSettings({});
    let changed: ((value: AppSettings) => void) | undefined;
    deps.getSettings = () => ({ success: true, data: settings });
    vi.mocked(deps.settingsService.on).mockImplementation((_event, listener) => {
      changed = listener;
      return deps.settingsService as ReturnType<typeof deps.settingsService.on>;
    });
    const service = new PolishService(deps);
    const warm = vi.spyOn(service, 'warmUp').mockImplementation(() => undefined);
    service.startWarmups();
    service.startWarmups();
    expect(warm).not.toHaveBeenCalled();
    expect(deps.settingsService.on).toHaveBeenCalledTimes(1);
    settings = { ...settings, polish: { enabled: true, model: 'one', style: 'auto' } };
    changed?.(settings);
    changed?.({ ...settings, polish: { ...settings.polish, style: 'cantonese' } });
    changed?.(settings);
    changed?.({ ...settings, polish: { enabled: true, model: 'two', style: 'auto' } });
    changed?.({ ...settings, polish: { enabled: false, model: 'three', style: 'auto' } });
    changed?.(settings);
    expect(warm.mock.calls).toEqual([['one'], ['two'], ['one']]);
    service.dispose();
    service.dispose();
    expect(deps.settingsService.off).toHaveBeenCalledTimes(1);
    expect(deps.settingsService.off).toHaveBeenCalledWith('changed', changed);
    warm.mockClear();
    service.startWarmups();
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledWith('one');
    service.dispose();
  });

  it('skips recently warmed models, retries failures and allows another model in flight', async () => {
    const deps = dependencies();
    let now = 0;
    deps.now = () => now;
    const request = vi.fn(async () => completion('ok'));
    deps.fetch = request;
    const service = new PolishService(deps);
    service.warmUp('one');
    service.warmUp('one');
    service.warmUp('two');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setImmediate(resolve));
    service.warmUp('one');
    expect(request).toHaveBeenCalledTimes(2);
    now = 60000;
    service.warmUp('one');
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    await new Promise(resolve => setImmediate(resolve));
    deps.fetch = vi.fn(async () => { throw new Error(key); });
    service.warmUp('failed');
    await vi.waitFor(() => expect(deps.logger.debug).toHaveBeenCalledWith('oMLX warm-up failed'));
    service.warmUp('failed');
    await vi.waitFor(() => expect(deps.fetch).toHaveBeenCalledTimes(2));
    expect(deps.logger.debug).not.toHaveBeenCalledWith(expect.stringContaining(key));
  });

  it('warms on startup when enabled and treats unreadable settings as off', () => {
    const deps = dependencies();
    deps.getSettings = () => ({ success: true, data: { ...getDefaultSettings({}), polish: { enabled: true, model: 'startup', style: 'auto' } } });
    const service = new PolishService(deps);
    const warm = vi.spyOn(service, 'warmUp').mockImplementation(() => undefined);
    service.startWarmups();
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm).toHaveBeenCalledWith('startup');
    service.dispose();
    warm.mockClear();
    deps.getSettings = () => ({ success: false, error: 'unavailable' });
    service.startWarmups();
    expect(warm).not.toHaveBeenCalled();
    service.dispose();
  });
});

describe('polish service HTTP', () => {
  let server: http.Server;
  let deps: PolishDependencies;
  let service: PolishService;
  let state: { status: number; reply: string; delay: number; requests: number; authorization?: string; body?: Record<string, unknown> };

  beforeEach(async () => {
    state = { status: 200, reply: '你好，世界。', delay: 0, requests: 0 };
    server = http.createServer((req, res) => {
      state.authorization = req.headers.authorization;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        if (req.method === 'POST') {
          state.requests++;
          state.body = JSON.parse(Buffer.concat(chunks).toString());
        }
        setTimeout(() => {
          res.writeHead(state.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(req.method === 'GET'
            ? { data: [{ id: options.model }] }
            : { choices: [{ message: { content: state.reply } }] }));
        }, state.delay);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    deps = dependencies();
    deps.readFile = async () => JSON.stringify({ server: { port }, auth: { api_key: key } });
    service = new PolishService(deps);
  });
  afterEach(async () => {
    service?.dispose();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('sends the expected body and Authorization and returns polished text', async () => {
    expect(await service.polish('你好世界', options)).toMatchObject({ text: '你好，世界。', polished: true, error: null });
    expect(state.authorization).toBe(`Bearer ${key}`);
    expect(state.body).toMatchObject({
      model: options.model, temperature: 0, stream: false, max_tokens: 72,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: expect.stringContaining('以下詞彙請保持這個寫法：Open Typeless') },
        { role: 'user', content: '<transcript>你好世界</transcript>' }],
    });
  });

  it('converts Simplified model output to Traditional', async () => {
    state.reply = '我们今天先处理 Open Typeless 的 bug，然后去台北。';
    expect(await service.polish('我们今天先处理open typeless的bug然后去台北', options))
      .toMatchObject({ text: '我們今天先處理 Open Typeless 的 bug，然後去台北。', polished: true });
  });

  it('omits Authorization when the config has no key', async () => {
    deps.readFile = async () => JSON.stringify({ server: { port: (server.address() as AddressInfo).port } });
    await service.polish('你好世界', options);
    expect(state.authorization).toBeUndefined();
  });

  it('falls back on HTTP 500 and implausibly long output', async () => {
    state.status = 500;
    expect(await service.polish('你好世界', options)).toMatchObject({ text: '你好世界', polished: false, error: 'oMLX responded with HTTP 500' });
    state.status = 200;
    state.reply = 'a'.repeat(100);
    expect(await service.polish('你好世界', options)).toMatchObject({ text: '你好世界', polished: false, error: 'Rejected polish output: too long' });
  });

  it('falls back after a slow response exceeds the injected timeout', async () => {
    deps.timers.setTimeout = callback => setTimeout(callback, 15);
    state.delay = 100;
    expect(await service.polish('你好世界', options)).toMatchObject({ text: '你好世界', polished: false, error: 'oMLX request timed out' });
    expect(await service.status()).toEqual({ available: false, reason: 'unreachable', models: [] });
  });

  it('reports available, unauthorized and unreachable states', async () => {
    expect(await service.status()).toEqual({ available: true, reason: null, models: [options.model] });
    for (const status of [401, 403]) {
      state.status = status;
      expect(await service.status()).toEqual({ available: false, reason: 'unauthorized', models: [] });
    }
    state.status = 500;
    expect(await service.status()).toEqual({ available: false, reason: 'unreachable', models: [] });
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(await service.status()).toEqual({ available: false, reason: 'unreachable', models: [] });
  });

  it('deduplicates warm-up requests and uses a one-token non-thinking completion', async () => {
    state.delay = 30;
    service.warmUp(options.model);
    service.warmUp(options.model);
    await vi.waitFor(() => expect(state.requests).toBe(1));
    expect(state.body).toMatchObject({ max_tokens: 1, chat_template_kwargs: { enable_thinking: false }, messages: [
      { role: 'system', content: expect.any(String) }, { role: 'user', content: '<transcript>測試</transcript>' },
    ] });
    await new Promise(resolve => setTimeout(resolve, 50));
    service.warmUp(options.model);
    expect(state.requests).toBe(1);
  });
});
