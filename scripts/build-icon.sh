#!/usr/bin/env bash
# Build the placeholder macOS icon using only the system image tools.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/waae-icon.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"

# A pre-rasterized source is useful in sandboxes where Quick Look cannot start.
PNG="${ICON_SOURCE_PNG:-$WORK/icon.svg.png}"
if [[ -z "${ICON_SOURCE_PNG:-}" ]]; then
  qlmanage -t -s 1024 -o "$WORK" "$ROOT/assets/icon.svg"
fi
for size in 16 32 64 128 256 512; do
  sips -z "$size" "$size" "$PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
if ! iconutil -c icns "$ICONSET" -o "$ROOT/assets/icon.icns"; then
  # Opt-in fallback for restricted macOS sessions where iconutil rejects valid PNGs.
  [[ "${ICON_ALLOW_FALLBACK:-0}" == "1" ]] || exit 1
  echo "iconutil unavailable; assembling the PNG icon representations" >&2
  python3 - "$ICONSET" "$ROOT/assets/icon.icns" <<'PYTHON'
import pathlib, struct, sys
source = pathlib.Path(sys.argv[1])
entries = [('icp4', 16, False), ('icp5', 32, False), ('icp6', 64, False),
           ('ic07', 128, False), ('ic08', 256, False), ('ic09', 512, False),
           ('ic10', 512, True), ('ic11', 16, True), ('ic12', 32, True),
           ('ic13', 128, True), ('ic14', 256, True)]
chunks = []
for kind, size, retina in entries:
    data = (source / f'icon_{size}x{size}{"@2x" if retina else ""}.png').read_bytes()
    chunks.append(kind.encode('ascii') + struct.pack('>I', len(data) + 8) + data)
body = b''.join(chunks)
pathlib.Path(sys.argv[2]).write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)
PYTHON
fi
echo "Built assets/icon.icns"
