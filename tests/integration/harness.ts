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
  app.whenReady()
    .then(scenario)
    .then(() => app.exit(failures === 0 ? 0 : 1))
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
export async function until(description: string, check: () => boolean, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
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
    req.resume();
    req.on('end', () => {
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
