#!/usr/bin/env node
/**
 * Checks a packaged macOS build (run `pnpm package` first) for problems that only
 * appear after packaging:
 * - migrations shipped in Resources/drizzle
 * - runtime modules required by the main bundle present in app.asar
 * - code signature identifier matching CFBundleIdentifier (needed for the
 *   microphone prompt) and a valid deep signature
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'out');
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
};

const buildDir = existsSync(outDir) ? readdirSync(outDir).find((name) => name.endsWith(`-darwin-${process.arch}`)) : undefined;
if (!buildDir) {
  console.error(`No darwin-${process.arch} build in out/; run pnpm package first`);
  process.exit(1);
}
const bundle = readdirSync(path.join(outDir, buildDir)).find((name) => name.endsWith('.app'));
const app = path.join(outDir, buildDir, bundle);
const resources = path.join(app, 'Contents', 'Resources');
console.log(`Checking ${path.relative(root, app)}`);

const migrations = path.join(resources, 'drizzle');
check(existsSync(path.join(migrations, 'meta', '_journal.json')) &&
  readdirSync(migrations).some((name) => name.endsWith('.sql')), 'migrations are in Resources/drizzle');

const files = new Set(asar.listPackage(path.join(resources, 'app.asar')).map((file) => file.replaceAll('\\', '/')));
const hasModule = (name) => files.has(`/node_modules/${name}/package.json`);
for (const name of ['ws', 'better-sqlite3', 'uiohook-napi', '@xitanggg/node-insert-text']) {
  check(hasModule(name), `${name} is packaged`);
}
check(hasModule(`@xitanggg/node-insert-text-darwin-${process.arch}`) || hasModule('@xitanggg/node-insert-text-darwin-universal'),
  'a node-insert-text binary for this architecture is packaged');
check(existsSync(path.join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', `darwin-${process.arch}.node`)),
  'the better-sqlite3 prebuild is unpacked');

const bundleId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app, 'Contents', 'Info.plist')]).toString().trim();
// codesign -dv prints its details on stderr
const signature = spawnSync('codesign', ['-dv', app], { encoding: 'utf8' }).stderr;
const identifier = signature.match(/^Identifier=(.+)$/m)?.[1];
check(identifier === bundleId, `signature identifier ${identifier} matches bundle id ${bundleId}`);
let validSignature = true;
try {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
} catch {
  validSignature = false;
}
check(validSignature, 'codesign --verify --deep --strict passes');

if (failures.length > 0) {
  console.error(`\n${failures.length} packaging check(s) failed`);
  process.exit(1);
}
console.log('\nAll packaging checks passed');
