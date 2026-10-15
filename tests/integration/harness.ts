/**
 * Minimal harness for tests that need the Electron main process.
 * Run through scripts/run-integration-tests.mjs, which sets INTEGRATION_TMP.
 *
 * - userData points at a temporary directory, so real user data is never touched
 * - textInputService.insert is replaced, so nothing is typed into other apps
 * - a fake whisper.cpp HTTP server runs in-process
 */

import http from 'node:http';
import net from 'node:net';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';

const tmp = process.env.INTEGRATION_TMP;
if (!tmp) {
  console.error('INTEGRATION_TMP is not set; run through scripts/run-integration-tests.mjs');
  process.exit(2);
}

export const TMP_DIR = tmp;
app.setPath('userData', path.join(tmp, 'userData'));
app.dock?.hide();
log.transports.console.level = false;
log.transports.file.level = false;

let failures = 0;

/** Run one named step; a thrown error marks it failed without stopping later steps. */
export async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

/** Throw with a readable message when a condition does not hold. */
export function assert(condition: unknown, message: string, details?: unknown): asserts condition {
  if (!condition) {
    throw new Error(details === undefined ? message : `${message}: ${JSON.stringify(details)}`);
  }
}

/** Start the scenario once Electron is ready and exit with the result. */
export function run(scenario: () => Promise<void>): void {
  // Electron quits when the last window closes unless someone listens for this; scenarios
  // open and close windows and must keep running
  app.on('window-all-closed', () => undefined);
  app.whenReady()
    .then(scenario)
    .then(() => {
      // scripts/run-integration-tests.mjs requires this line to count the file as passed
      console.log('INTEGRATION SCENARIO COMPLETE');
      app.exit(failures === 0 ? 0 : 1);
    })
    .catch((error) => {
      console.error('Scenario crashed:', error);
      app.exit(2);
    });
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until a condition holds. Prefer this to fixed waits: CI machines can be several
 * times slower than a laptop, and asynchronous work (history writes, transcription,
 * insertion) must be awaited by its effect, not by elapsed time.
 */
export async function until(
  description: string,
  check: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}`);
    await wait(25);
  }
}

/** One second of 220 Hz tone: clearly above the silence threshold. */
export function toneChunk(ms = 1000, amplitude = 4000): ArrayBuffer {
  const samples = Math.round((ms * 16000) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buffer.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / 16000)), i * 2);
  }
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
}

/** Digital silence of the given length. */
export function silenceChunk(ms = 1000): ArrayBuffer {
  return new ArrayBuffer(Math.round((ms * 16000) / 1000) * 2);
}

export interface FakeWhisper {
  url: string;
  inferences: number;
  /** The `prompt` form field of the last inference request, or null when absent */
  lastPrompt: string | null;
  mode: 'ok' | 'error';
  text: string;
  /** Delay before GET / answers, to simulate a server still loading */
  healthDelayMs: number;
  close: () => Promise<void>;
}

/** In-process stand-in for the whisper.cpp HTTP API on a free loopback port. */
export async function startFakeWhisper(text = '你好'): Promise<FakeWhisper> {
  const state: FakeWhisper = {
    url: '',
    inferences: 0,
    lastPrompt: null,
    mode: 'ok',
    text,
    healthDelayMs: 0,
    close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('ok');
      }, state.healthDelayMs);
      return;
    }
    state.inferences++;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      // Multipart form data: the prompt part is plain text between boundaries
      const body = Buffer.concat(chunks).toString('utf8');
      state.lastPrompt = body.match(/name="prompt"\r\n\r\n([\s\S]*?)\r\n--/)?.[1] ?? null;
      if (state.mode === 'error') {
        res.writeHead(500);
        res.end('boom');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: state.text }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}

/** A loopback URL on which nothing listens. */
export async function unusedUrl(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

export interface FakeOmlx {
  embeddingRequests: number;
  lastEmbeddingBody: Record<string, unknown> | null;
  port: number;
  requests: number;
  lastAuthorization: string | null;
  lastBody: Record<string, unknown> | null;
  mode: 'ok' | 'error';
  reply: string;
  close: () => Promise<void>;
}

/** In-process local oMLX API; warm-ups and dictations use the same endpoint. */
export async function startFakeOmlx(): Promise<FakeOmlx> {
  const state: FakeOmlx = {
    embeddingRequests: 0, lastEmbeddingBody: null,
    port: 0, requests: 0, lastAuthorization: null, lastBody: null,
    mode: 'ok', reply: '你好，世界。', close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    state.lastAuthorization = req.headers.authorization ?? null;
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'Qwen3.5-9B-4bit' }, { id: 'Qwen3.8-27B-oQ4e-mtp' }, { id: 'Qwen3-Embedding-0.6B' }] }));
      return;
    }
    const embedding = req.url === '/v1/embeddings';
    if (req.method !== 'POST' || (!embedding && req.url !== '/v1/chat/completions')) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (embedding) state.embeddingRequests++;
    else state.requests++;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (embedding) {
        state.lastEmbeddingBody = body;
        const inputs = Array.isArray(body.input) ? body.input : [body.input];
        // Orthogonal keyword vectors make retrieval assertions independent of model behavior.
        const data = inputs.map((text: string, index: number) => {
          const vector = Array<number>(1024).fill(0);
          const key = /Ken/i.test(text) ? 0 : /Coffee/i.test(text) ? 1 : 2;
          vector[key] = 1;
          return { index, embedding: vector };
        });
        res.writeHead(state.mode === 'error' ? 500 : 200, { 'content-type': 'application/json' });
        res.end(state.mode === 'error' ? 'boom' : JSON.stringify({ data }));
        return;
      }
      state.lastBody = body;
      res.writeHead(state.mode === 'error' ? 500 : 200, { 'content-type': 'application/json' });
      res.end(state.mode === 'error' ? 'boom' : JSON.stringify({ choices: [{ message: { content: state.reply } }] }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  state.port = (server.address() as net.AddressInfo).port;
  state.close = () => new Promise(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  return state;
}

/** Only writes the integration runner's isolated config; never the user's home. */
export async function writeOmlxSettings(port: number | null, apiKey: string | null): Promise<void> {
  const file = process.env.OMLX_SETTINGS_PATH;
  if (!file || !file.startsWith(`${TMP_DIR}${path.sep}`)) throw new Error('Missing isolated OMLX_SETTINGS_PATH');
  if (port === null) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ server: { port }, auth: { api_key: apiKey } }), { mode: 0o600 });
}
