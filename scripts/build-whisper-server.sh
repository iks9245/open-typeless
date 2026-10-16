#!/usr/bin/env bash
# Build the whisper-server bundled with the app: one static executable with the Metal
# library embedded, tuned for every Apple Silicon Mac (M1 and later) rather than the
# build machine. Writes resources/bin/whisper-server and a version stamp next to it.
#
# Skips the build when the stamp already matches; set FORCE=1 to rebuild.
set -euo pipefail

WHISPER_VERSION="v1.9.5"
# The tag must resolve to this commit, so a moved tag cannot change what gets built
WHISPER_COMMIT="d1be6fde11ac6e0407606b4e42fe72d34add8037"
# M1 is ARMv8.5 with dot product and FP16; later chips add more, which ggml does not need
CPU_ARCH="armv8.2-a+dotprod+fp16"
# Accelerate's cblas_sgemm (used by the BLAS backend) needs macOS 13.3; Electron 40 itself needs 12
DEPLOYMENT_TARGET="13.3"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${WHISPER_BUILD_CACHE:-$ROOT/node_modules/.cache/whisper.cpp}"
SRC="$CACHE/src-$WHISPER_VERSION"
BUILD="$CACHE/build-$WHISPER_VERSION"
OUT="$ROOT/resources/bin"
STAMP="$OUT/whisper-server.version"
STAMP_TEXT="whisper.cpp $WHISPER_VERSION ($WHISPER_COMMIT) cpu=$CPU_ARCH macos=$DEPLOYMENT_TARGET static metal-embedded"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "build-whisper-server: only Apple Silicon macOS is supported" >&2
  exit 1
fi

if [[ "${FORCE:-0}" != "1" && -x "$OUT/whisper-server" && -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_TEXT" ]]; then
  echo "whisper-server is up to date: $STAMP_TEXT"
  exit 0
fi

if [[ ! -d "$SRC/.git" ]]; then
  mkdir -p "$CACHE"
  git clone --quiet --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp.git "$SRC"
fi
actual="$(git -C "$SRC" rev-parse HEAD)"
if [[ "$actual" != "$WHISPER_COMMIT" ]]; then
  echo "build-whisper-server: $WHISPER_VERSION is $actual, expected $WHISPER_COMMIT" >&2
  exit 1
fi

cmake -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET" \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_CPU_ARM_ARCH="$CPU_ARCH" \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DGGML_BLAS=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_BUILD_SERVER=ON \
  -DWHISPER_SDL2=OFF \
  -DWHISPER_CURL=OFF \
  > "$CACHE/cmake-configure.log"
cmake --build "$BUILD" --config Release --target whisper-server -j "$(sysctl -n hw.ncpu)" > "$CACHE/cmake-build.log"

mkdir -p "$OUT"
install -m 755 "$BUILD/bin/whisper-server" "$OUT/whisper-server"

# Self-contained: only system libraries and frameworks may be linked
external="$(otool -L "$OUT/whisper-server" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)' || true)"
if [[ -n "$external" ]]; then
  echo "build-whisper-server: links non-system libraries:" >&2
  echo "$external" >&2
  exit 1
fi

echo "$STAMP_TEXT" > "$STAMP"
echo "Built $OUT/whisper-server: $STAMP_TEXT"
