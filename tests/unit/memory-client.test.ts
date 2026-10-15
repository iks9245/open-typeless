import { describe, expect, it, vi } from 'vitest';
import { createEmbeddings } from '../../src/main/services/polish/lib/omlx-client';

const config = { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'private-key' };
const signal = () => new AbortController().signal;
describe('local embeddings client', () => {
  it('sends only model/input with authorization, disallows redirects, and orders by response index', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [
      { index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] },
    ] })));
    const abort = signal();
    expect(await createEmbeddings(config, { model: 'embedding', input: ['one', 'two'] }, fetch, abort)).toEqual([[1, 0], [0, 1]]);
    expect(fetch.mock.calls).toHaveLength(1);
    const call = vi.mocked(fetch as typeof globalThis.fetch).mock.calls[0];
    expect(call[0]).toBe('http://127.0.0.1:1234/v1/embeddings');
    expect(call[1]).toMatchObject({ method: 'POST', signal: abort, redirect: 'error', headers: { Authorization: 'Bearer private-key' } });
    expect(JSON.parse(String(call[1]?.body))).toEqual({ model: 'embedding', input: ['one', 'two'] });
  });
  it('omits authorization without a key and accepts a single input string', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1] }] })));
    expect(await createEmbeddings({ ...config, apiKey: null }, { model: 'embedding', input: 'one' }, fetch, signal())).toEqual([[1]]);
    expect(fetch.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  });
  it.each([
    {}, { data: [] }, { data: [{ index: 0, embedding: [] }] }, { data: [{ index: 0, embedding: [0, 0] }] },
    { data: [{ index: 0, embedding: [1] }, { index: 0, embedding: [1] }] },
    { data: [{ index: 0, embedding: [1] }, { index: 1, embedding: [1, 0] }] },
    { data: [{ index: 0, embedding: [1e100] }] },
  ])('rejects malformed embeddings %j', async data => {
    const fetch = async () => new Response(JSON.stringify(data));
    await expect(createEmbeddings(config, { model: 'embedding', input: 'one' }, fetch, signal()))
      .rejects.toThrow('Invalid oMLX embeddings response');
  });
  it('returns safe HTTP/JSON errors without exposing server bodies', async () => {
    await expect(createEmbeddings(config, { model: 'embedding', input: 'one' }, async () => new Response('private body', { status: 401 }), signal()))
      .rejects.toThrow('oMLX responded with HTTP 401');
    await expect(createEmbeddings(config, { model: 'embedding', input: 'one' }, async () => new Response('private body'), signal()))
      .rejects.toThrow('Invalid oMLX JSON response');
  });
});
