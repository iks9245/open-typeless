import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import path from 'path';
import { cp, mkdir, readdir } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Native modules that need special handling for packaging
const nativeModules = [
  'uiohook-napi',
  '@xitanggg/node-insert-text',
  // node-insert-text loads its binary from a per-platform package; missing ones are skipped
  '@xitanggg/node-insert-text-darwin-arm64',
  '@xitanggg/node-insert-text-darwin-x64',
  '@xitanggg/node-insert-text-darwin-universal',
  // Loads its own N-API prebuild from prebuilds/; no runtime dependencies.
  'better-sqlite3',
  // Kept external in vite.main.config.ts and required at startup; no runtime dependencies
  'ws',
  // Dependencies
  'node-gyp-build',
];

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '*.{node,dll}',
    },
    // Drizzle migration SQL, read at startup from process.resourcesPath/drizzle
    extraResource: ['./drizzle'],
  },
  rebuildConfig: {
    force: true,
  },
  hooks: {
    // Copy native modules after packaging
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const sourceNodeModulesPath = path.resolve(__dirname, 'node_modules');
      const destNodeModulesPath = path.resolve(buildPath, 'node_modules');

      await Promise.all(
        nativeModules.map(async (packageName) => {
          const sourcePath = path.join(sourceNodeModulesPath, packageName);
          const destPath = path.join(destNodeModulesPath, packageName);
          try {
            await mkdir(path.dirname(destPath), { recursive: true });
            await cp(sourcePath, destPath, {
              recursive: true,
              preserveTimestamps: true,
            });
          } catch (error) {
            // Module might not exist (platform-specific)
            console.warn(`Could not copy native module ${packageName}:`, error);
          }
        }),
      );
    },
    // Without a signing identity, re-sign the finished macOS bundle ad-hoc so its
    // code signature identifier matches CFBundleIdentifier. The fuses plugin signs
    // earlier, while the bundle is still Electron.app (com.github.Electron), and
    // macOS privacy (TCC) then never prompts for or lists the renamed app's
    // microphone access, so recordings are silent.
    postPackage: async (forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin' || forgeConfig.packagerConfig.osxSign) {
        return;
      }

      for (const outputPath of outputPaths) {
        const bundles = (await readdir(outputPath)).filter((entry) => entry.endsWith('.app'));
        for (const bundle of bundles) {
          await execFileAsync('codesign', ['--force', '--deep', '--sign', '-', path.join(outputPath, bundle)]);
        }
      }
    },
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
        {
          entry: 'src/preload-floating.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
        {
          name: 'floating_window',
          config: 'vite.floating.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: false, // Required for native modules (.node files)
    }),
  ],
};

export default config;
