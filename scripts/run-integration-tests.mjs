#!/usr/bin/env node
/**
 * Runs tests/integration/*.test.ts inside the real Electron main process.
 *
 * Each test file is bundled with esbuild (native modules and electron stay external)
 * and launched as `electron <bundle>` with its own temporary directory in
 * INTEGRATION_TMP. A test passes when Electron exits with code 0.
 *
 * Usage: node scripts/run-integration-tests.mjs [name-filter]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(root, 'tests', 'integration');
const outDir = path.join(root, 'node_modules', '.cache', 'integration');
const electron = path.join(root, 'node_modules', '.bin', 'electron');
const TIMEOUT_MS = 180000;
const filter = process.argv[2];
/** Printed by tests/integration/harness.ts run() after the whole scenario finished */
const SCENARIO_COMPLETE = 'INTEGRATION SCENARIO COMPLETE';

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts') && (!filter || name.includes(filter)))
  .sort();

if (files.length === 0) {
  console.error('No integration tests matched');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// UI tests load the real main window, so build its renderer and preload first
const uiEnv = {};
if (files.some((name) => name.startsWith('main-window'))) {
  const { build: viteBuild } = await import('vite');
  const rendererDir = path.join(outDir, 'renderer');
  await viteBuild({
    configFile: path.join(root, 'vite.renderer.config.ts'),
    root,
    // Relative asset URLs, as the packaged app loads index.html from file://
    base: './',
    logLevel: 'warn',
    build: { outDir: rendererDir, emptyOutDir: true },
  });
  const preload = path.join(outDir, 'preload.js');
  await build({
    entryPoints: [path.join(root, 'src', 'preload.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: preload,
    external: ['electron'],
    logLevel: 'warning',
  });
  uiEnv.INTEGRATION_RENDERER_HTML = path.join(rendererDir, 'index.html');
  uiEnv.INTEGRATION_PRELOAD = preload;
}

const run = (bundle, tmp, file) => new Promise((resolve) => {
  const child = spawn(electron, [bundle], {
    cwd: root,
    env: { ...process.env, ...uiEnv, INTEGRATION_TMP: tmp, OMLX_SETTINGS_PATH: path.join(tmp, 'omlx', 'settings.json'), OPEN_TYPELESS_MODEL_CATALOG: file.startsWith('main-window-model-download') ? path.join(tmp, 'model-catalog.json') : '', ELECTRON_ENABLE_LOGGING: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const timer = setTimeout(() => {
    output += `\nTimed out after ${TIMEOUT_MS} ms`;
    child.kill('SIGKILL');
  }, TIMEOUT_MS);
  child.on('exit', (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal, output });
  });
});

let failed = 0;
for (const file of files) {
  const bundle = path.join(outDir, file.replace(/\.ts$/, '.cjs'));
  await build({
    entryPoints: [path.join(testDir, file)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: bundle,
    external: ['electron', 'better-sqlite3', 'uiohook-napi', '@xitanggg/node-insert-text', 'ws'],
    logLevel: 'warning',
  });

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'open-typeless-it-'));
  const started = Date.now();
  const { code, signal, output } = await run(bundle, tmp, file);
  rmSync(tmp, { recursive: true, force: true });

  // A scenario passes only if it ran to the end: an app that quit early (for example when
  // its last window closed) also exits with code 0
  const lines = output.split('\n');
  const completed = lines.includes(SCENARIO_COMPLETE);
  const passed = code === 0 && completed;
  // Show only the harness lines unless the run failed
  const report = passed ? lines.filter((line) => line.startsWith('  ✓') || line.startsWith('  ✗')) : lines;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${file} (${Date.now() - started} ms)`);
  console.log(report.filter((line) => line.trim() && line !== SCENARIO_COMPLETE).join('\n'));
  if (!passed) {
    failed++;
    console.log(`  exit code ${code}${signal ? `, signal ${signal}` : ''}${completed ? '' : ', scenario did not run to the end'}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} integration test files passed`);
process.exit(failed ? 1 : 0);
