/** First-run setup through the real renderer, preload, IPC and verified M2 transfer. */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { nativeTheme } from 'electron';
import { MODEL_CATALOG } from '../../src/shared/constants/model-catalog';
import { assert, run, test, until, startFakeOmlx, writeOmlxSettings } from './harness';
import { openMainWindow } from './ui';

run(async () => {
  const content = Buffer.concat([Buffer.from('lmgg'), Buffer.alloc(128 * 1024, 42)]);
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
      response.write(content.subarray(position, position + 2048));
      position += 2048;
      if (position >= content.length) { clearInterval(timer); response.end(); }
    }, 25);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const catalog = MODEL_CATALOG.map(entry => ({
    ...entry, fileName: `ggml-onboarding-${entry.key}.bin`, size: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/${entry.key}`,
  }));
  const override = process.env.OPEN_TYPELESS_MODEL_CATALOG;
  assert(override, 'runner supplies an isolated fake catalog');
  await writeFile(override, JSON.stringify(catalog));
  await writeOmlxSettings(null, null);

  const { initDatabase } = await import('../../src/main/db');
  assert(initDatabase(undefined, path.resolve('drizzle')), 'database initialized');
  const { settingsService } = await import('../../src/main/services/settings');
  const { historyService } = await import('../../src/main/services/history');
  const { permissionsService } = await import('../../src/main/services/permissions');
  const { setupAllIpcHandlers } = await import('../../src/main/ipc');
  const { getModelDownloadService } = await import('../../src/main/services/model-download');
  const { whisperServerService } = await import('../../src/main/services/whisper-server');
  // Deterministic missing OS permissions; never open a real prompt or System Settings.
  permissionsService.getMicrophoneStatus = () => 'denied';
  permissionsService.getAccessibilityStatus = () => false;
  permissionsService.requestMicrophonePermission = async () => false;
  setupAllIpcHandlers();
  const service = getModelDownloadService();
  const ui = await openMainWindow({ onboarding: true });
  const key = 'large-v3-cantonese-q8_0';
  const entry = catalog.find(entry => entry.key === key);
  assert(entry, 'Cantonese catalog entry exists');
  const settings = () => {
    const result = settingsService.get();
    assert(result.success, 'settings readable');
    return result.data;
  };
  const step = async (name: string) => {
    await ui.waitFor(`onboarding-step-${name}`);
    await ui.waitUntil('settings write settled', "!document.querySelector('[data-testid=onboarding-back]')?.disabled");
  };
  const reload = async (name?: string) => {
    await new Promise<void>(resolve => {
      ui.window.webContents.once('did-finish-load', () => resolve());
      ui.window.webContents.reload();
    });
    if (name) await step(name);
  };

  try {
    nativeTheme.themeSource = 'light';
    await test('fresh storage shows the wizard instead of tabs; language applies recognition and polish together', async () => {
      await step('welcome');
      assert(await ui.count('tab-history') === 0, 'tabs absent');
      assert((await ui.text('onboarding-progress')) === '第 1／7 步', 'progress announced');
      await ui.waitUntil('heading focused', "document.activeElement.id === 'onboarding-heading'");
      await ui.click('onboarding-language-yue');
      await until('language saved', () => settings().onboarding.primaryLanguage === 'yue');
      assert(settings().asr.language === null, 'language is automatic');
      assert(settings().polish.style === 'standard', 'style is standard');
      await ui.click('onboarding-next');
      await step('model');
      // The catalog loads asynchronously after the step appears
      await ui.waitFor(`onboarding-model-${key}`);
      assert((await ui.text(`onboarding-model-${key}`)).includes('推薦'), 'Cantonese model recommended');
      assert(await ui.exec<boolean>(`document.querySelector('[data-testid="onboarding-model-${key}"] input').checked`), 'recommended card selected');
      await ui.screenshot('onboarding-model-light');
    });
    await test('reload resumes the saved step; transfer supports cancel and resume and automatically selects the verified model', async () => {
      await reload('model');
      assert(settings().onboarding.step === 'model', 'step persisted');
      await ui.click(`onboarding-model-download-${key}`);
      await ui.waitFor('onboarding-download-progress');
      await until('partial bytes', async () => (await service.catalog()).some(entry => entry.key === key && entry.partialBytes > 0));
      await ui.click(`onboarding-model-cancel-${key}`);
      await ui.waitUntil('resume available', `document.querySelector('[data-testid="onboarding-model-download-${key}"]')?.textContent.includes('繼續下載')`);
      await ui.click(`onboarding-model-download-${key}`);
      await until('download completion selects model', () => settings().asr.model === `app/${entry.fileName}`, 15000);
      assert(ranges.some(range => /^bytes=[1-9]\d*-$/.test(range)), 'resumed with Range');
      await ui.waitUntil('next enabled', "document.querySelector('[data-testid=onboarding-next]')?.disabled === false");
      await ui.click('onboarding-next');
      await step('microphone');
    });
    await test('both permission steps allow skipping with guidance; try detects text success', async () => {
      await ui.waitFor('onboarding-permission-status');
      assert(await ui.exec<boolean>("document.body.textContent.includes('略過後無法錄音')"), 'microphone skip warning');
      await ui.click('onboarding-skip');
      await step('accessibility');
      assert(await ui.exec<boolean>("document.body.textContent.includes('偵測快捷鍵')"), 'Accessibility explanation');
      await ui.click('onboarding-skip');
      await step('try');
      await ui.waitUntil('trial focused', "document.activeElement.id === 'onboarding-try-input'");
      assert(await ui.exec<boolean>("document.querySelector('[data-testid=onboarding-next]').disabled"), 'trial required until success or skip');
      assert(await ui.exec<boolean>("document.body.textContent.includes('設定麥克風') && document.body.textContent.includes('設定輔助使用')"), 'missing permission links');
      await ui.type('onboarding-try-input', '你好，這是第一次聽寫。');
      await ui.waitFor('onboarding-try-success');
      await ui.click('onboarding-next');
      await step('ai');
    });
    await test('AI explains oMLX is unavailable; finish opens tabs and stores completion', async () => {
      await ui.waitFor('onboarding-ai-unavailable');
      assert((await ui.text('onboarding-ai-unavailable')).includes('oMLX'), 'oMLX explained');
      await ui.click('onboarding-next');
      await step('done');
      assert(await ui.exec<boolean>("document.body.textContent.includes('Shift +') && document.body.textContent.includes('Control +')"), 'shortcuts shown');
      await ui.screenshot('onboarding-done-light');
      await ui.click('onboarding-finish');
      await ui.waitFor('tab-history');
      assert(settings().onboarding.completed && settings().onboarding.step === null, 'completion persisted');
      await reload();
      // Completed users must return to tabs after reload.
      await ui.waitFor('tab-history');
      assert(await ui.count('onboarding-wizard') === 0, 'wizard remains completed');
    });
    await test('settings can rerun setup; installed recommendation is preselected and works in dark mode', async () => {
      await ui.click('tab-settings');
      await ui.click('settings-rerun-onboarding');
      await step('welcome');
      assert(!settings().onboarding.completed, 'rerun stored');
      assert(settings().onboarding.primaryLanguage === 'yue', 'language retained');
      await ui.click('onboarding-next');
      await step('model');
      // The catalog loads asynchronously after the step appears
      await ui.waitFor(`onboarding-model-${key}`);
      assert((await ui.text(`onboarding-model-${key}`)).includes('已安裝'), 'installed shown');
      assert(await ui.exec<boolean>(`document.querySelector('[data-testid="onboarding-model-${key}"] input').checked`), 'installed recommended selected');
      nativeTheme.themeSource = 'dark';
      await ui.waitUntil('dark mode', "matchMedia('(prefers-color-scheme: dark)').matches");
      await ui.screenshot('onboarding-model-dark');
      assert(ui.securityPolicyViolations.length === 0, 'no CSP violations', ui.securityPolicyViolations);
    });
    await test('if recommendation is absent, the first installed catalog model is selected', async () => {
      await ui.click('onboarding-back');
      await step('welcome');
      await ui.click('onboarding-language-en');
      await until('English choice saved', () => settings().onboarding.primaryLanguage === 'en');
      await ui.click('onboarding-next');
      await step('model');
      await ui.waitUntil('installed fallback selected', `document.querySelector('[data-testid="onboarding-model-${key}"] input')?.checked`);
      await ui.click('onboarding-next');
      await step('microphone');
      assert(settings().asr.model === `app/${entry.fileName}`, 'installed fallback applied');
    });
    await test('live grants auto-advance and a recent history completion also counts as trial success', async () => {
      permissionsService.getMicrophoneStatus = () => 'granted';
      await step('accessibility');
      permissionsService.getAccessibilityStatus = () => true;
      await step('try');
      // Reload clears textarea state, while preserving the current wizard step.
      await reload('try');
      assert(await ui.exec<boolean>("document.querySelector('[data-testid=onboarding-next]').disabled"), 'fresh trial initially incomplete');
      const id = historyService.begin({ engine: 'whisper.cpp' });
      assert(id, 'history session begun');
      await historyService.complete(id, { rawText: '試用文字', finalText: '試用文字', audioDurationMs: 1000, latencyMs: 50, detectedLanguage: null });
      await ui.waitFor('onboarding-try-success');
      assert(!await ui.exec<boolean>("document.querySelector('[data-testid=onboarding-next]').disabled"), 'history success enables next');
      assert(ui.securityPolicyViolations.length === 0, 'no CSP violations', ui.securityPolicyViolations);
    });
    await test('available oMLX offers installed models and saves AI switches with the memory recommendation', async () => {
      const omlx = await startFakeOmlx();
      try {
        await writeOmlxSettings(omlx.port, null);
        await ui.click('onboarding-next');
        await step('ai');
        await ui.waitFor('onboarding-polish-model');
        const info = await ui.exec<{ success: boolean; data: { totalMemoryGb: number } }>('window.api.system.info()');
        assert(info.success, 'system info available');
        const command = info.data.totalMemoryGb >= 32 ? 'Qwen3.8-27B-oQ4e-mtp' : 'Qwen3.5-9B-4bit';
        assert(await ui.exec<string>("document.querySelector('[data-testid=onboarding-command-model]').value") === command, 'recommended installed command model selected');
        await ui.click('onboarding-polish-enabled');
        assert(await ui.checked('onboarding-polish-enabled'), 'polish enabled');
        await ui.click('onboarding-next');
        await step('done');
        assert(settings().polish.enabled && settings().polish.model === 'Qwen3.5-9B-4bit', 'polish saved');
        assert(settings().command.enabled && settings().command.model === command, 'command saved');
        assert(ui.securityPolicyViolations.length === 0, 'no CSP violations', ui.securityPolicyViolations);
      } finally {
        await writeOmlxSettings(null, null);
        await omlx.close();
      }
    });
  } finally {
    nativeTheme.themeSource = 'system';
    await service.cancel();
    await whisperServerService.stop();
    ui.window.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
