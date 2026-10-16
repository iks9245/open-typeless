#!/usr/bin/env node
/**
 * Checks a packaged macOS build (run `pnpm package` first) for problems that only
 * appear after packaging:
 * - both preload bundles and renderer Content-Security-Policy meta tags
 * - migrations shipped in Resources/drizzle
 * - runtime modules required by the main bundle present in app.asar
 * - bundled whisper-server architecture, system links, macOS minimum, signature and help
 * - code signature identifier matching CFBundleIdentifier (needed for the
 *   microphone prompt) and a valid deep signature
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

const archive = path.join(resources, 'app.asar');
const files = new Set(asar.listPackage(archive).map((file) => file.replaceAll('\\', '/')));
for (const preload of ['preload.js', 'preload-floating.js']) {
  check(files.has(`/.vite/build/${preload}`), `${preload} is packaged`);
}
for (const page of ['main_window/index.html', 'floating_window/floating.html']) {
  const file = `.vite/renderer/${page}`;
  const html = files.has(`/${file}`) ? asar.extractFile(archive, file).toString('utf8') : '';
  check(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*content=["'][^"']+/i.test(html),
    `${page} contains the CSP meta tag`);
}

const hasModule = (name) => files.has(`/node_modules/${name}/package.json`);
for (const name of ['ws', 'better-sqlite3', 'uiohook-napi', '@xitanggg/node-insert-text']) {
  check(hasModule(name), `${name} is packaged`);
}
check(hasModule(`@xitanggg/node-insert-text-darwin-${process.arch}`) || hasModule('@xitanggg/node-insert-text-darwin-universal'),
  'a node-insert-text binary for this architecture is packaged');
check(existsSync(path.join(resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', `darwin-${process.arch}.node`)),
  'the better-sqlite3 prebuild is unpacked');

const plist = path.join(app, 'Contents', 'Info.plist');
const bundleId = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]).toString().trim();
const minimumSystemVersion = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', plist], { encoding: 'utf8' });
check(minimumSystemVersion.status === 0 && minimumSystemVersion.stdout.trim() === '13.3', 'Info.plist requires macOS 13.3');
// codesign -dv prints its details on stderr
const signature = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' }).stderr;
const identifier = signature.match(/^Identifier=(.+)$/m)?.[1];
check(identifier === bundleId, `signature identifier ${identifier} matches bundle id ${bundleId}`);
let validSignature = true;
try {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
} catch {
  validSignature = false;
}
check(validSignature, 'codesign --verify --deep --strict passes');
// Informational: an ad-hoc build loses macOS privacy grants on every rebuild
const authority = signature.match(/^Authority=(.+)$/m)?.[1];
console.log(`ℹ signed ${/^Signature=adhoc$/m.test(signature) ? 'ad-hoc' : `by "${authority ?? 'unknown'}"`}`);

const whisper = path.join(resources, 'whisper-server');
check(existsSync(whisper) && statSync(whisper).isFile(), 'whisper-server is in Resources');
let executable = false;
try {
  accessSync(whisper, constants.X_OK);
  executable = statSync(whisper).isFile();
} catch { /* Report a missing or non-executable binary below. */ }
check(executable, 'whisper-server is executable');
if (executable) {
  const architectures = spawnSync('lipo', ['-archs', whisper], { encoding: 'utf8' });
  check(architectures.status === 0 && architectures.stdout.trim() === 'arm64', 'whisper-server is arm64-only');

  const linked = spawnSync('otool', ['-L', whisper], { encoding: 'utf8' });
  const libraries = linked.stdout?.trim().split('\n').slice(1).map(line => line.trim().split(/\s+/)[0]) ?? [];
  check(linked.status === 0 && libraries.length > 0 && libraries.every(library => /^(\/usr\/lib\/|\/System\/Library\/)/.test(library)),
    'whisper-server links only system libraries and frameworks');

  const loadCommands = spawnSync('otool', ['-l', whisper], { encoding: 'utf8' });
  const buildVersion = loadCommands.stdout?.split(/Load command \d+/).find(command => /\bcmd LC_BUILD_VERSION\b/.test(command));
  check(loadCommands.status === 0 && /^\s*minos 13\.3(?:\.0)?\s*$/m.test(buildVersion ?? ''), 'whisper-server minos is 13.3');

  const verified = spawnSync('codesign', ['--verify', '--strict', whisper], { encoding: 'utf8' });
  check(verified.status === 0, 'whisper-server codesign --verify --strict passes');
  const whisperSignature = spawnSync('codesign', ['-dvv', whisper], { encoding: 'utf8' });
  const authorities = details => details?.match(/^Authority=.+$/gm)?.join('\n');
  const appAuthorities = authorities(signature);
  const sameAuthority = appAuthorities
    ? appAuthorities === authorities(whisperSignature.stderr)
    : /^Signature=adhoc$/m.test(signature) && /^Signature=adhoc$/m.test(whisperSignature.stderr ?? '');
  check(whisperSignature.status === 0 && sameAuthority, 'whisper-server is signed by the same authority as the app (or both ad-hoc)');

  // Pinned whisper.cpp v1.9.5 exits 0 for --help (examples/server/server.cpp).
  const help = spawnSync(whisper, ['--help'], { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL' });
  check(!help.error && help.status === 0, 'whisper-server --help exits 0 within 10 seconds');
}
const stamp = path.join(resources, 'whisper-server.version');
check(existsSync(stamp), 'whisper-server version stamp is packaged');
if (existsSync(stamp)) console.log(`ℹ ${readFileSync(stamp, 'utf8').trim()}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} packaging check(s) failed`);
  process.exit(1);
}
console.log('\nAll packaging checks passed');
