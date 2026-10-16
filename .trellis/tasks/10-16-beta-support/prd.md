# M6 封測支援

## Goal
Beta testers can report problems with one click: export a diagnostics archive that contains
everything needed to debug and **no dictation content**. They can also see and copy version
information. Uncaught errors must reach the log so the archive actually helps.

## Finding (2026-10-16)
- Logs contain no transcript content. I checked 8-character fragments of all 115 stored
  `raw_text`/`final_text` values against `main.log`. The only matches were ASCII technical words
  (for example `interrupt`), and there were no whisper segment lines (`[00:00.000 --> …]`).
- The repository is public, but GitHub Issues is disabled, so a feedback link has nowhere to point yet.

## Requirements

### Error capture
- Main process: `log.errorHandler.startCatching()` (electron-log 5), with no dialog. The log
  records unhandled rejections and uncaught exceptions with their stacks.
- Renderer (main and floating windows): forward `console-message` events of level `error` from
  their webContents to the log as `(renderer:main)` or `(renderer:floating)`, with message, source
  file name (basename only) and line.

### Diagnostics service (`src/main/services/diagnostics/`, injectable)
`collect()` returns a JSON-serializable report:
- **app**: version, Electron, Chrome, Node versions, packaged flag, and the bundled whisper.cpp
  version stamp when present.
- **system**: macOS version (`os.release()` plus `process.getSystemVersion()`), CPU model
  (`os.cpus()[0].model`), total memory GB, free disk GB on the userData volume (`statfs`), locale.
- **settings**: the full `AppSettings`, except `asr.vocabulary`, which is replaced by
  `{ count }`. Nothing else is removed. Settings hold no secrets: the oMLX key is never stored.
- **whisperServer**: the renderer-safe `WhisperServerInfo`.
- **permissions**: `{ microphone, accessibility }`.
- **polish**: the oMLX status `{ available, reason, modelCount }`. Never the key.
- **models**: catalog keys with installed, partial and active flags.
- **memory**: the index status.
- **history**:
  - counts by status, mode, error code and insert status;
  - the last 50 rows as `{ createdAt (ISO), status, mode, audioDurationMs, latencyMs, errorCode, errorMessage (≤ 200 chars), insertStatus, engineModel }`.
  - **No** `rawText`, `finalText`, `audioPath`, `meta` or id.

`export(targetZipPath)`:
- Writes into a fresh temp dir:
  - `diagnostics.json` (pretty);
  - `logs/main.log` and `logs/main.old.log` when present, each limited to its last 2 MB;
  - `README.txt` (Traditional Chinese), listing what is included and excluded.
- **Redaction before writing**: replace the home directory path with `~` everywhere in the JSON
  and logs, and the user name (`os.userInfo().username`) when it appears as a path segment.
- Zip with `/usr/bin/ditto -c -k --keepParent` and remove the temp dir.
- Returns the zip path, kept in the main process only.

### IPC (role `main`)
- `diagnostics:summary`: the `app` and `system` sections, for the About UI.
- `diagnostics:export`:
  - shows `dialog.showSaveDialog` on the main window, with default
    `~/Desktop/open-typeless-diagnostics-YYYYMMDD-HHmm.zip`;
  - exports and returns `{ saved: boolean, fileName }`, with the file name only;
  - the user can cancel.
- `diagnostics:reveal`: `shell.showItemInFolder` on the last exported zip.
- `diagnostics:feedback`: `shell.openExternal(FEEDBACK_URL)` only when the constant is set.

### Feedback channel
`FEEDBACK_URL` in `src/shared/constants/support.ts` is `null` for now. Its comment says GitHub Issues
is disabled and the owner decides the channel. The button is hidden while it is null.

### UI
Settings gets a new last section 「關於與支援」 (`about-heading`):
- **Version list** (`about-versions`): app, whisper.cpp, Electron, macOS, chip, memory.
- **「複製版本資訊」** (`about-copy`): copies a plain-text block to the clipboard and shows 「已複製」.
- **「匯出診斷資料」** (`about-export-diagnostics`):
  - help text: 「包含版本、設定（不含詞彙表內容）、伺服器與權限狀態、最近 50 次聽寫的時間與錯誤代碼，以及記錄檔。不含任何聽寫文字、錄音、詞彙表內容或金鑰。」
  - after saving: 「已儲存 {fileName}」 and 「在 Finder 中顯示」.
- **「回報問題」**: shown only when `FEEDBACK_URL` is set.

## Acceptance criteria
- [ ] Unit tests:
  - collect contains no `rawText`/`finalText`/`audioPath`/`meta`/ids; seed history rows with
    distinctive text and assert it appears nowhere in the JSON;
  - vocabulary replaced by count;
  - error message truncated;
  - log tail limit;
  - home path and user name redaction in JSON and logs;
  - the zip contains the expected entries (unzip with `ditto -x -k` in the test);
  - IPC role checks;
  - feedback hidden when null.
- [ ] Integration (UI):
  - the About section renders versions;
  - copy puts the version text on the clipboard;
  - export is stubbed at the dialog level by injecting the save path in tests, produces a zip, and
    shows 「已儲存」;
  - no CSP violations.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
