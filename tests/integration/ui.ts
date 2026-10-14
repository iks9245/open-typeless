/**
 * Drives the real main window in UI integration tests.
 * Requires INTEGRATION_RENDERER_HTML and INTEGRATION_PRELOAD, which
 * scripts/run-integration-tests.mjs builds for main-window*.test.ts files.
 * Elements are addressed by their data-testid attribute.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { wait } from './harness';

export interface UiDriver {
  window: BrowserWindow;
  /** Renderer console output, for checks such as the recording hook */
  console: string[];
  exec<T>(script: string): Promise<T>;
  waitFor(testId: string, options?: { count?: number; timeoutMs?: number }): Promise<void>;
  waitUntil(description: string, script: string, timeoutMs?: number): Promise<void>;
  count(testId: string): Promise<number>;
  text(testId: string, index?: number): Promise<string>;
  texts(testId: string): Promise<string[]>;
  click(testId: string, index?: number): Promise<void>;
  type(testId: string, value: string): Promise<void>;
  select(testId: string, value: string): Promise<void>;
  /** Select the option whose visible text contains the label */
  selectLabel(testId: string, label: string): Promise<void>;
  pressEnter(testId: string): Promise<void>;
  blur(testId: string): Promise<void>;
  checked(testId: string): Promise<boolean>;
  screenshot(name: string): Promise<void>;
}

const selector = (testId: string): string => JSON.stringify(`[data-testid="${testId}"]`);
const element = (testId: string, index = 0): string =>
  `document.querySelectorAll(${selector(testId)})[${index}]`;

/** Open the built main window with the real preload and wait for the UI to mount. */
export async function openMainWindow(): Promise<UiDriver> {
  const html = process.env.INTEGRATION_RENDERER_HTML;
  const preload = process.env.INTEGRATION_PRELOAD;
  if (!html || !preload) throw new Error('Renderer not built; run through scripts/run-integration-tests.mjs');

  const window = new BrowserWindow({
    width: 960,
    height: 680,
    show: false,
    // Hidden windows are throttled and would capture stale frames without this
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  // Never let tests reach the real microphone (and a macOS permission prompt)
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission !== 'media'));
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => permission !== 'media');
  const consoleLines: string[] = [];
  window.webContents.on('console-message', (_event, _level, message) => consoleLines.push(message));
  await window.loadFile(html);

  const exec = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script, true) as Promise<T>;

  const waitUntil = async (description: string, script: string, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await exec<boolean>(`Boolean(${script})`)) return;
      await wait(50);
    }
    throw new Error(`Timed out waiting for ${description}`);
  };

  const driver: UiDriver = {
    window,
    console: consoleLines,
    exec,
    waitUntil,
    waitFor: (testId, options = {}) => waitUntil(
      options.count === undefined ? testId : `${options.count} × ${testId}`,
      options.count === undefined
        ? `document.querySelector(${selector(testId)})`
        : `document.querySelectorAll(${selector(testId)}).length === ${options.count}`,
      options.timeoutMs,
    ),
    count: (testId) => exec(`document.querySelectorAll(${selector(testId)}).length`),
    text: (testId, index = 0) => exec(`(${element(testId, index)}?.textContent ?? '').trim()`),
    texts: (testId) => exec(`[...document.querySelectorAll(${selector(testId)})].map((el) => el.textContent.trim())`),
    click: async (testId, index = 0) => {
      await driver.waitFor(testId);
      await exec(`${element(testId, index)}.click()`);
    },
    // React tracks input values itself: use the native setter, then dispatch an input event
    type: async (testId, value) => {
      await driver.waitFor(testId);
      await exec(`(() => {
        const el = ${element(testId)};
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    },
    select: async (testId, value) => {
      await driver.waitFor(testId);
      await exec(`(() => {
        const el = ${element(testId)};
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    },
    selectLabel: async (testId, label) => {
      await driver.waitFor(testId);
      const value = await exec<string | null>(`(() => {
        const option = [...${element(testId)}.options].find((o) => o.textContent.includes(${JSON.stringify(label)}));
        return option ? option.value : null;
      })()`);
      if (value === null) throw new Error(`No option containing "${label}" in ${testId}`);
      await driver.select(testId, value);
    },
    pressEnter: (testId) => exec(`${element(testId)}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`),
    // Hidden test windows have no focus, so el.blur() would not fire: dispatch focusout
    // (what React's onBlur listens to) directly
    blur: (testId) => exec(`${element(testId)}.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`),
    checked: (testId) => exec(`(() => {
      const el = ${element(testId)};
      if (el.matches('input[type="checkbox"]')) return el.checked;
      const own = el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed');
      if (own !== null) return own === 'true';
      const input = el.querySelector('input[type="checkbox"]');
      return input ? input.checked : false;
    })()`),
    screenshot: async (name) => {
      const dir = process.env.INTEGRATION_SCREENSHOTS;
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      // Wait for React to commit and the compositor to paint the current state
      await exec('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await wait(150);
      const image = await window.webContents.capturePage();
      writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
    },
  };

  await driver.waitFor('tab-history', { timeoutMs: 10000 });
  return driver;
}
