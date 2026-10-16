# M1 內建 whisper-server

## Goal
New users should not have to build whisper.cpp. The packaged app ships its own whisper-server:
one static executable with the Metal library embedded, tuned for every Apple Silicon Mac, and
signed together with the app. A user's own whisper.cpp build still works as a fallback.

## Findings (2026-10-16)
- The user's `~/whisper.cpp` build cannot be redistributed:
  - `GGML_NATIVE=ON` targets the build machine (M4), so it may crash on M1/M2;
  - it links six `@rpath` dylibs (libwhisper, libggml, libggml-cpu, -blas, -metal, -base).
- `scripts/build-whisper-server.sh` builds whisper.cpp **v1.9.5**, pinned to commit `d1be6fde…`.
  The build is static (`BUILD_SHARED_LIBS=OFF`) with `GGML_NATIVE=OFF`,
  `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`, `GGML_METAL_EMBED_LIBRARY=ON` and BLAS (Accelerate).
- The result is an 8.4 MB arm64 executable that links only system frameworks.
  - Its minimum macOS is **13.3**, because Accelerate's `cblas_sgemm` is unavailable before 13.3.
  - A 12.0 target compiled with availability warnings and would crash on 12–13.2.
- Same output and speed as the native build: Cantonese q8_0 0.73 s and turbo 0.50 s per sentence,
  identical text. It uses the embedded Metal library.

## Requirements

### Build (already in place)
- `scripts/build-whisper-server.sh` writes `resources/bin/whisper-server` and
  `resources/bin/whisper-server.version`.
- It skips the build when the stamp matches (`FORCE=1` rebuilds) and fails if the tag resolves to
  another commit or the binary links non-system libraries.
- Add `resources/bin/` to `.gitignore`.

### Forge (`forge.config.ts`)
- `hooks.generateAssets` runs before start and package. On darwin arm64 it runs the build script
  and streams its output; on other platforms it skips with a message.
- `packagerConfig.extraResource` gains `./resources/bin/whisper-server` and
  `./resources/bin/whisper-server.version`. They land in `Contents/Resources/`.
- `packagerConfig.extendInfo`: `{ LSMinimumSystemVersion: '13.3' }`.
- `postPackage` signs `Contents/Resources/whisper-server` with the same identity **before**
  signing the app bundle.

### Discovery (`src/main/services/whisper-server`)
- New injectable dependency `bundledBinary: () => string | null`:
  - packaged: `path.join(process.resourcesPath, 'whisper-server')`;
  - development: `<app path>/resources/bin/whisper-server`, when it exists.
- **Binary precedence:**
  1. env `WHISPER_SERVER_BIN`
  2. bundled
  3. `~/whisper.cpp/build/bin/whisper-server`
  4. `/opt/homebrew/bin/whisper-server`
  5. `/usr/local/bin/whisper-server`
- Status and `WhisperServerInfo` gain
  `binarySource: 'env' | 'bundled' | 'whisper.cpp' | 'homebrew' | 'system' | null`.
  The renderer shows 「內建」 for bundled, next to the binary name.
- Adoption, ownership and restart behavior is unchanged.

### CI (`.github/workflows/ci.yml`)
- Before 「Package」:
  - restore an `actions/cache` of `node_modules/.cache/whisper.cpp` and `resources/bin`, keyed on
    `hashFiles('scripts/build-whisper-server.sh')`;
  - add a step 「Build whisper-server」 that runs the script.
- Ensure `cmake` is available on the runner. It is preinstalled on macOS images; fail clearly
  otherwise.

### Package verification (`scripts/verify-package.mjs`)
- `Contents/Resources/whisper-server` exists, is executable, and is arm64-only (`lipo -archs`).
- It links only `/usr/lib/` and `/System/Library/` (`otool -L`), and its `minos` is 13.3
  (`otool -l` `LC_BUILD_VERSION`).
- `codesign --verify --strict` passes on it, and it is signed by the same authority as the app.
- `whisper-server --help` exits within 10 s, with exit code 0 or the binary's documented help code.
- `Info.plist` `LSMinimumSystemVersion` is `13.3`.
- Print the version stamp as information.

### Docs
README: system requirements (Apple Silicon, macOS 13.3+), whisper.cpp is no longer required for
the packaged app, and how the bundled build is made and pinned.

## Acceptance criteria
- [ ] Unit tests:
  - discovery precedence with bundled present or absent, plus env override;
  - `binarySource` mapping;
  - info mapping, names only.
- [ ] typecheck, lint, test:unit and test:integration pass.
- [ ] package and verify:package pass locally, and in CI with the cache.
- [ ] The packaged app starts the bundled server, with status 「內建」.
