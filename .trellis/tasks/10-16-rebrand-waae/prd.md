# M5 改名為 WaaE

## Goal
Rename the product from "Open Typeless" / `open-typeless` to **WaaE**, so it no longer uses the
Typeless trademark. Existing users keep all their data through a one-time migration. The
original author keeps credit.

## Decisions
- **Product name**: `WaaE`, the user's choice on 2026-10-16. A Chinese name is not decided yet,
  so do not invent one; UI copy uses 「WaaE」.
- **Bundle id**: `io.github.iks9245.waae`. It is unique to the owner's GitHub account, so no
  domain is needed.
- **Package name**: `waae`. **productName / executable**: `WaaE`. The packaged app is
  `out/WaaE-darwin-arm64/WaaE.app`.
- **Credit**: the project was started by taosu (mindfold.ai) as open-typeless, and package.json
  declares MIT. Keep `author`. Add a README 「致謝」 section and an About line:
  「本專案基於 taosu 的 open-typeless（MIT）發展而成」. **Do not create a LICENSE file**; the
  owner will confirm the license text with the original author first.

## Requirements

### Names (user-visible and identifiers)
- **package.json**: `name: "waae"`, `productName: "WaaE"`. Forge `packagerConfig`:
  `name: 'WaaE'`, `executableName: 'WaaE'`, `appBundleId: 'io.github.iks9245.waae'`,
  `icon: 'assets/icon'`.
- **Strings to change**: window titles, the `index.html` title, the header brand text, the footer,
  onboarding and settings copy, the accessibility dialog (it already uses `app.getName()`), and the
  floating window title (`floating.html`: 「WaaE」).
- **Diagnostics archive name**: `waae-diagnostics-YYYYMMDD-HHmm.zip`.
- **Internal names**:
  - the selection sentinel prefix becomes `waae-selection-`;
  - the dev-only env var `OPEN_TYPELESS_MODEL_CATALOG` becomes `WAAE_MODEL_CATALOG`;
  - update every reference, including `scripts/run-integration-tests.mjs`.
- **Signing identity**: `forge.config.ts` accepts `"WaaE Dev"` and still falls back to
  `"Open Typeless Dev"`, so the existing self-signed certificate keeps working. Document both.
- **Database file**: `open-typeless.db` becomes `waae.db` (`src/main/db/client.ts` and `init.ts`).
- **Tests and fixtures**: update the references.
  - Example vocabulary that mentions "Open Typeless" in tests and in the `vocabulary-prompt`
    docs/comments may stay as example data, but the user-facing examples in the UI should say
    "WaaE".
- **Leave untouched**: `.trellis/**`, `electron-doc/**`, `use-case/**` and the original author's
  journal are history.
- **README**: product name, bundle id, data and log locations, the migration, and the credit.

### One-time migration (`src/main/services/migration/legacy-data.ts`, injectable fs/process deps)
- **Where it runs**: synchronously at the top of `main.ts`, before `app.whenReady` and before
  anything opens storage or writes to userData.
- **Paths**: `old = <appData>/open-typeless`, `new = app.getPath('userData')` (`<appData>/WaaE`).
- **Condition**: it runs only when `old/open-typeless.db` exists and `new/waae.db` does not.
  Otherwise it does nothing.
- **Old app running** (a process whose command is the old executable
  `…/open-typeless.app/Contents/MacOS/open-typeless`, checked with `ps -axo command`):
  - do not migrate;
  - show `dialog.showMessageBoxSync` 「請先結束舊版 open-typeless，再重新開啟 WaaE。」 and
    `app.exit(0)`.
- **Steps**:
  1. Open the old DB with better-sqlite3, run `PRAGMA wal_checkpoint(TRUNCATE)`, and close it.
  2. `mkdir -p new`.
  3. Rename `open-typeless.db` to `new/waae.db`. Rename `-wal`/`-shm` along with it if they still
     exist after the checkpoint.
  4. Rename the directories `models/`, `audio/` and `Local Storage/` into `new/` when present.
     Skip a target that already exists and log it.
  5. Write `old/MOVED-TO-WaaE.txt` saying where the data went.
- **Never moved**: `whisper-server.pid` and Chromium caches.
- **Same volume**: renames are on the same volume, so they are instant. If a rename fails with
  `EXDEV`, fall back to copy and then delete, verifying sizes.
- **Failure**: on any error, stop, leave the remaining old files in place, log it, and continue
  starting with whatever was moved. Never delete old data on failure.
- **Logs**: electron-log now writes to `~/Library/Logs/WaaE/`. Old logs are not moved.
- **Permissions**: macOS treats the new bundle id as a new app, so Microphone and Accessibility
  must be granted again. When migration happened and `onboarding.completed` is true:
  - show the onboarding wizard's microphone and accessibility steps again: set
    `onboarding.completed = false` and `step = 'microphone'`, keeping everything else;
  - the wizard shows a one-line notice 「WaaE 是 open-typeless 的新名稱，資料已經搬過來；macOS 需要重新授權一次。」
    when a flag `onboarding.migratedFromLegacy = true` is set. Clear the flag at done.

### Icon (`assets/icon.svg`, `assets/icon.icns`, `scripts/build-icon.sh`)
- **Design**: a simple placeholder, to be replaced by a designer later.
  - rounded square (macOS squircle proportions, 1024 px, about 10% margin);
  - deep teal to blue gradient;
  - a white speech bubble with the letters 「WaaE」 or 「W」 centered, bold and legible at 32 px.
- **Build**: `scripts/build-icon.sh` rasterizes the SVG with `qlmanage -t -s 1024`, makes the
  iconset sizes with `sips` (16, 32, 64, 128, 256, 512 at 1x and 2x), and runs `iconutil -c icns`.
- Commit the generated `icon.icns`. It is small, and CI does not need to build it.

### Verify package
`scripts/verify-package.mjs` expects:
- `WaaE.app`;
- `CFBundleIdentifier io.github.iks9245.waae`, matching the signature identifier;
- `CFBundleName WaaE`;
- an icon file (`CFBundleIconFile` set and present in Resources).

## Acceptance criteria
- [ ] Unit tests for the migration, using a temp appData:
  - moves the db (with a WAL checkpoint against a real better-sqlite3 db with WAL content), models,
    audio and Local Storage;
  - writes the marker;
  - skips when the new db exists, and skips when the old db is missing;
  - the old app running → no move and the exit path taken;
  - a partial failure leaves the remaining old data;
  - the `EXDEV` fallback;
  - permission re-onboarding flags are set only when onboarding was completed.
- [ ] A grep for `open-typeless|Open Typeless|com.electron.` outside the excluded history folders
  finds only the credit, migration code, compatibility fallbacks and test fixtures that test them.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
