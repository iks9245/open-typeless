import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readOmlxConfig } from '../../src/main/services/polish/lib/omlx-config';
import type { PolishConfigDependencies } from '../../src/main/services/polish/types';

describe('oMLX discovery', () => {
  let tmp: string;
  let file: string;
  let deps: PolishConfigDependencies;
  const key = 'secret-key-never-log-this';
  const logger = { debug: vi.fn(), warn: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    tmp = await mkdtemp(path.join(os.tmpdir(), 'omlx-config-'));
    file = path.join(tmp, '.omlx', 'settings.json');
    await mkdir(path.dirname(file));
    deps = { readFile: file => readFile(file, 'utf8'), env: {}, homedir: () => tmp, logger };
  });
  afterEach(async () => {
    expect(JSON.stringify([logger.debug.mock.calls, logger.warn.mock.calls])).not.toContain(key);
    await rm(tmp, { recursive: true, force: true });
  });

  it('ignores the server host, reads the key and rereads changes', async () => {
    await writeFile(file, JSON.stringify({ server: { port: 11123, host: 'evil.example' }, auth: { api_key: key } }));
    expect(await readOmlxConfig(deps)).toEqual({ baseUrl: 'http://127.0.0.1:11123/v1', apiKey: key });
    await writeFile(file, JSON.stringify({ server: { port: 1234 } }));
    expect(await readOmlxConfig(deps)).toEqual({ baseUrl: 'http://127.0.0.1:1234/v1', apiKey: null });
  });

  it('uses OMLX_SETTINGS_PATH instead of the home directory', async () => {
    const override = path.join(tmp, 'override.json');
    await writeFile(override, JSON.stringify({ server: { port: 65535 } }));
    deps.env = { OMLX_SETTINGS_PATH: override };
    expect((await readOmlxConfig(deps))?.baseUrl).toBe('http://127.0.0.1:65535/v1');
  });

  it.each([0, -1, 65536, 1.5, '11123', null, undefined])('rejects invalid port %j without logging the key', async (port) => {
    await writeFile(file, JSON.stringify({ server: { port }, auth: { api_key: key } }));
    expect(await readOmlxConfig(deps)).toBeNull();
  });

  it.each(['', '  ', 123, null])('treats non-string or blank key %j as absent', async (api_key) => {
    await writeFile(file, JSON.stringify({ server: { port: 1 }, auth: { api_key } }));
    expect((await readOmlxConfig(deps))?.apiKey).toBeNull();
  });

  it.each([null, 123, 'invalid', {}])('treats invalid auth %j as no key while retaining a valid port', async (auth) => {
    await writeFile(file, JSON.stringify({ server: { port: 11123 }, auth }));
    expect(await readOmlxConfig(deps)).toEqual({ baseUrl: 'http://127.0.0.1:11123/v1', apiKey: null });
  });

  it('handles missing, unreadable and malformed files without exposing contents', async () => {
    expect(await readOmlxConfig(deps)).toBeNull();
    await writeFile(file, `{"auth":{"api_key":"${key}"},broken`);
    expect(await readOmlxConfig(deps)).toBeNull();
    deps.readFile = async () => { throw new Error(key); };
    expect(await readOmlxConfig(deps)).toBeNull();
  });
});
