import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandService } from '../../src/main/services/command/command.service';
import type { CommandDependencies } from '../../src/main/services/command/types';

const options = { model: 'command-model' };
function dependencies(): CommandDependencies {
  return {
    readFile: async () => JSON.stringify({ server: { port: 1234 }, auth: { api_key: 'secret-key' } }),
    env: {}, homedir: () => '/unused', fetch: globalThis.fetch, now: Date.now,
    timers: { setTimeout, clearTimeout }, logger: { debug: vi.fn(), warn: vi.fn() },
    captureSelection: vi.fn(async () => 'selection'),
  };
}
const completion = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

describe('command service without sockets', () => {
  it('delegates selection and measures request latency', async () => {
    const deps = dependencies();
    deps.now = vi.fn().mockReturnValueOnce(10).mockReturnValue(35);
    deps.fetch = vi.fn(async () => completion('<think>private reasoning</think><selection>「我们」</selection>'));
    const service = new CommandService(deps);
    expect(await service.captureSelection()).toBe('selection');
    expect(await service.run('改成簡體', '我們今天先處理事情', options))
      .toEqual({ text: '我们', error: null, latencyMs: 25 });
    expect(deps.logger.warn).not.toHaveBeenCalled();
  });

  it.each(['😀', null])('builds authenticated requests and budgets without sockets for selection %j', async selection => {
    const deps = dependencies();
    deps.fetch = vi.fn(async () => completion('output'));
    const timer = vi.spyOn(deps.timers, 'setTimeout');
    expect(await new CommandService(deps).run('instruction', selection, options)).toMatchObject({ text: 'output', error: null });
    const [url, init] = vi.mocked(deps.fetch).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer secret-key' }, redirect: 'error' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: options.model, temperature: 0, stream: false, max_tokens: selection === null ? 1024 : 259,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: expect.any(String) }, { role: 'user', content: selection === null
        ? '<instruction>instruction</instruction>' : '<instruction>instruction</instruction>\n<selection>😀</selection>' }],
    });
    expect(timer.mock.calls[0][1]).toBe(selection === null ? 55960 : 25360);
  });

  it.each([401, 500])('returns HTTP %s errors without sockets', async status => {
    const deps = dependencies();
    deps.fetch = async () => new Response('error', { status });
    expect(await new CommandService(deps).run('instruction', 'private selection', options))
      .toMatchObject({ text: '', error: `oMLX responded with HTTP ${status}` });
  });

  it('accepts arbitrary output lengths without OpenCC conversion', async () => {
    const deps = dependencies();
    deps.fetch = async () => completion('我们'.repeat(100));
    expect((await new CommandService(deps).run('生成', null, options)).text).toBe('我们'.repeat(100));
    deps.fetch = async () => completion('好');
    expect((await new CommandService(deps).run('縮短', 'a'.repeat(200), options)).text).toBe('好');
  });

  it('keeps markup and comparisons in the output, removing only its own wrapper tags', async () => {
    const deps = dependencies();
    deps.fetch = async () => completion('<selection><div class="a">x</div> 且 a < b > c</selection>');
    expect((await new CommandService(deps).run('改 HTML', '<div>x</div>', options)).text).toBe('<div class="a">x</div> 且 a < b > c');
  });

  it('returns an error without raw instruction fallback for missing config', async () => {
    const deps = dependencies();
    deps.readFile = async () => { throw new Error('missing'); };
    expect(await new CommandService(deps).run('instruction', null, options))
      .toMatchObject({ text: '', error: 'oMLX not installed' });
  });

  it('never exposes selection or credentials through arbitrary transport errors', async () => {
    const deps = dependencies();
    deps.fetch = async () => { throw new Error('private selection secret-key'); };
    const result = await new CommandService(deps).run('instruction', 'private selection', options);
    expect(result).toMatchObject({ text: '', error: 'oMLX request failed' });
    expect(JSON.stringify(vi.mocked(deps.logger.warn).mock.calls)).not.toMatch(/private selection|secret-key/);
  });

  it('aborts a hung request, returns an error and clears its timer', async () => {
    const deps = dependencies();
    let signal: AbortSignal | null | undefined;
    deps.fetch = async (_url, init) => { signal = init?.signal; return new Promise(() => undefined); };
    deps.timers.setTimeout = callback => setTimeout(callback, 5);
    const clear = vi.spyOn(deps.timers, 'clearTimeout');
    expect(await new CommandService(deps).run('instruction', null, options))
      .toMatchObject({ text: '', error: 'oMLX request timed out' });
    expect((signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
  });

  it.each(['', '  ', '<think>thinking</think>', '<selection></selection>', '<think>unfinished'])('rejects empty sanitized output %j', async output => {
    const deps = dependencies();
    deps.fetch = async () => completion(output);
    expect(await new CommandService(deps).run('instruction', null, options)).toMatchObject({ text: '', error: 'Empty command output' });
  });

  it('uses the shared deduplicated warm-up', async () => {
    const deps = dependencies();
    deps.fetch = vi.fn(async () => completion('warm'));
    const service = new CommandService(deps);
    service.warmUp(options.model);
    service.warmUp(options.model);
    await vi.waitFor(() => expect(deps.fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(String(vi.mocked(deps.fetch).mock.calls[0][1]?.body)).max_tokens).toBe(1);
  });
});

describe('command service HTTP', () => {
  let server: http.Server;
  let deps: CommandDependencies;
  let state: { status: number; reply: string; delay: number; body?: Record<string, unknown>; authorization?: string };
  beforeEach(async () => {
    state = { status: 200, reply: 'Generated text', delay: 0 };
    server = http.createServer((req, res) => {
      state.authorization = req.headers.authorization;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        state.body = JSON.parse(Buffer.concat(chunks).toString());
        setTimeout(() => {
          res.writeHead(state.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: state.reply } }] }));
        }, state.delay);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    deps = dependencies();
    deps.readFile = async () => JSON.stringify({ server: { port: (server.address() as AddressInfo).port }, auth: { api_key: 'secret-key' } });
  });
  afterEach(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each(['😀', null])('sends the configured non-thinking body for selection %j', async selection => {
    const timer = vi.spyOn(deps.timers, 'setTimeout');
    expect(await new CommandService(deps).run('instruction', selection, options)).toMatchObject({ text: 'Generated text', error: null });
    expect(state.authorization).toBe('Bearer secret-key');
    expect(state.body).toMatchObject({
      model: options.model, temperature: 0, stream: false, max_tokens: selection === null ? 1024 : 259,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: expect.any(String) }, { role: 'user', content: selection === null
        ? '<instruction>instruction</instruction>' : '<instruction>instruction</instruction>\n<selection>😀</selection>' }],
    });
    expect(timer.mock.calls[0][1]).toBe(selection === null ? 55960 : 25360);
  });

  it('returns HTTP and empty-output errors without inserting the instruction', async () => {
    const service = new CommandService(deps);
    state.status = 500;
    expect(await service.run('instruction', null, options)).toMatchObject({ text: '', error: 'oMLX responded with HTTP 500' });
    state.status = 200;
    state.reply = '';
    expect(await service.run('instruction', null, options)).toMatchObject({ text: '', error: 'Empty command output' });
  });

  it('times out a slow HTTP response', async () => {
    deps.timers.setTimeout = callback => setTimeout(callback, 10);
    state.delay = 100;
    expect(await new CommandService(deps).run('instruction', null, options)).toMatchObject({ text: '', error: 'oMLX request timed out' });
  });
});
