/** Model management through the real preload, IPC, streaming fetch and settings UI. */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { nativeTheme } from 'electron';
import { MODEL_CATALOG } from '../../src/shared/constants/model-catalog';
import type { ModelCatalogState } from '../../src/shared/types/model-download';
import { assert, run, test, until, wait } from './harness';
import { openMainWindow } from './ui';

run(async () => {
  const content = Buffer.concat([Buffer.from('lmgg'), Buffer.from(Array.from({ length: 256 * 1024 }, (_, i) => i % 251))]);
  const ranges: string[] = [];
  const server = http.createServer((request, response) => {
    const offset = Number(request.headers.range?.match(/\d+/)?.[0] ?? 0);
    if (request.headers.range) ranges.push(request.headers.range);
    response.writeHead(offset ? 206 : 200, {
      'content-type': 'application/octet-stream', 'content-length': content.length - offset,
      ...(offset ? { 'content-range': `bytes ${offset}-${content.length - 1}/${content.length}` } : {}),
    });
    let position = offset;
    const timer = setInterval(() => {
      response.write(content.subarray(position, position + 4096));
      position += 4096;
      if (position >= content.length) { clearInterval(timer); response.end(); }
    }, 25);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const key = 'ui-download';
  const entry = { ...MODEL_CATALOG[1], key, fileName: 'ggml-ui-download.bin', title: '整合測試模型', size: content.length,
    sha256: createHash('sha256').update(content).digest('hex'), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/file` };
  const override = process.env.OPEN_TYPELESS_MODEL_CATALOG;
  assert(override, 'runner provides isolated catalog override');
  await writeFile(override, JSON.stringify([entry, { ...entry, key: 'ui-other', fileName: 'ggml-ui-other.bin', title: '另一個模型', recommendedFor: 'light' }]));
  const { initDatabase } = await import('../../src/main/db');
  assert(initDatabase(undefined, path.resolve('drizzle')), 'database initialized');
  const { settingsService } = await import('../../src/main/services/settings');
  const { setupAllIpcHandlers } = await import('../../src/main/ipc');
  const { getModelDownloadService } = await import('../../src/main/services/model-download');
  setupAllIpcHandlers();
  const service = getModelDownloadService();
  const ui = await openMainWindow();
  nativeTheme.themeSource = 'light';
  const catalog = async () => {
    const result = await ui.exec<{ success: boolean; data: ModelCatalogState[] }>('window.api.models.catalog()');
    assert(result.success, 'catalog succeeds');
    return result.data.find(value => value.key === key);
  };
  const selected = () => {
    const result = settingsService.get();
    assert(result.success, 'settings readable');
    return result.data.asr.model;
  };
  try {
    await ui.click('tab-settings');
    await ui.waitFor(`model-start-${key}`);
    await test('download progress disables other downloads, completes, and refreshes the model select', async () => {
      await ui.click(`model-start-${key}`);
      await ui.waitFor('model-download-progress');
      assert(await ui.exec<boolean>(`document.querySelector('[data-testid="model-start-ui-other"]').disabled`), 'other download disabled');
      await ui.waitUntil('progress receives bytes', `Number(document.querySelector('[data-testid="model-download-progress"]')?.getAttribute('aria-valuenow')) > 0`);
      await ui.screenshot('model-download-progress-light');
      await ui.waitFor(`model-installed-${key}`, { timeoutMs: 15000 });
      await ui.waitUntil('downloaded model in recognition select', `document.querySelector('[data-testid="settings-asr-model"]').textContent.includes('${entry.fileName}')`);
      assert((await catalog())?.installed, 'verified catalog installed flag');
    });
    await test('use sets asr.model; delete confirms the filename and size before removing and resets settings', async () => {
      await ui.click(`model-use-${key}`);
      await until('selected downloaded model', () => selected() === `app/${entry.fileName}`);
      await ui.click(`model-delete-${key}`);
      await ui.waitFor(`model-delete-confirm-${key}`);
      assert((await catalog())?.installed, 'nothing deleted before confirming');
      assert(await ui.exec<boolean>(`document.querySelector('[role="alertdialog"]').textContent.includes('${entry.fileName}') && document.querySelector('[role="alertdialog"]').textContent.includes('MB')`), 'confirmation includes filename and size');
      await ui.click(`model-delete-confirm-${key}`);
      await ui.waitFor(`model-start-${key}`);
      assert(!(await catalog())?.installed, 'model removed');
      assert(selected() === null, 'selected model reset automatically');
      await ui.waitUntil('removed from recognition select', `!document.querySelector('[data-testid="settings-asr-model"]').textContent.includes('${entry.fileName}')`);
    });
    await test('cancel preserves bytes and continue resumes using Range', async () => {
      await ui.click(`model-start-${key}`);
      await until('partial has bytes', async () => ((await catalog())?.partialBytes ?? 0) > 0);
      await ui.click(`model-cancel-${key}`);
      await ui.waitUntil('continue label', `document.querySelector('[data-testid="model-start-${key}"]')?.textContent.includes('繼續下載')`);
      assert(((await catalog())?.partialBytes ?? 0) > 0, 'partial retained');
      await ui.waitFor(`model-discard-${key}`);
      await ui.click(`model-start-${key}`);
      await ui.waitFor(`model-installed-${key}`, { timeoutMs: 15000 });
      assert(ranges.some(range => /^bytes=[1-9]\d*-$/.test(range)), 'Range resumed existing bytes', ranges);
    });
    await test('download controls render in dark mode without CSP violations', async () => {
      nativeTheme.themeSource = 'dark';
      await ui.waitUntil('dark mode', "matchMedia('(prefers-color-scheme: dark)').matches");
      await ui.screenshot('model-download-installed-dark');
      await wait(50);
      assert(ui.securityPolicyViolations.length === 0, 'no CSP violations', ui.securityPolicyViolations);
    });
  } finally {
    nativeTheme.themeSource = 'system';
    await service.cancel();
    ui.window.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
