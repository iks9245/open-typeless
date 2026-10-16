# M2 模型下載管理

## Goal
New users download a speech-recognition model inside the app: pick from a curated catalog, see
progress, resume after interruptions, and get only a verified file. The settings page manages
installed models. The first-run wizard (M3) reuses the same API.

## Catalog (`src/shared/constants/model-catalog.ts`)
URLs are pinned to a repository commit, and every file is verified by SHA-256 before use.

| key | fileName (saved as) | title | size (bytes) | sha256 | url | license |
|---|---|---|---|---|---|---|
| `large-v3-cantonese-q8_0` | `ggml-large-v3-cantonese-q8_0.bin` | 粵語（推薦粵語使用者） | 1656538283 | `ad7a1cd90a6e70937c46c85b8a0aafd225e706e3ed56b10d6815afdd1c2e59cb` | `https://huggingface.co/kiuckhuang/whisper-large-v3-cantonese-ggml/resolve/fe2b5c4e7f19e2280ee2bb4429613363771b7c5a/whisper-large-v3-cantonese.q8_0.bin` | Apache-2.0 |
| `large-v3-turbo` | `ggml-large-v3-turbo.bin` | 多語言（推薦） | 1624555275 | `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo.bin` | MIT |
| `large-v3-turbo-q5_0` | `ggml-large-v3-turbo-q5_0.bin` | 多語言輕量版（記憶體較小的 Mac） | 574041195 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` | `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin` | MIT |

Each entry also has:
- `description`, in Traditional Chinese. The Cantonese one says it writes colloquial Cantonese
  directly (98% of colloquial characters kept in our evaluation), and that Mandarin and English
  stay correct with automatic language detection;
- `sourcePage` (the repository URL);
- `recommendedFor: 'cantonese' | 'general' | 'light'`;
- `credit`, for the Cantonese model:
  「由 kiuckhuang 轉換自 khleeloo/whisper-large-v3-cantonese」.

The two local files on the developer machine were hashed and match these SHA-256 values.

## Download service (`src/main/services/model-download/`, injectable deps)
- **One download at a time:**
  - `start(key)` returns at once and fails if another download is active;
  - `cancel()` aborts the request and keeps the partial file so it can resume;
  - `discard(key)` deletes the partial file.
- **Partial file:** `<userData>/models/.partial/<fileName>.part`, plus a `.json` sidecar holding
  `{ key, sha256, size }`. A stale sidecar for another sha is discarded.
- **Resume:** when a partial exists, send `Range: bytes=<partSize>-`. On `206` append; on `200`,
  restart from zero. Before resuming, hash the existing bytes, streaming them, so the final
  SHA-256 covers the whole file.
- **Redirects:** follow them (Hugging Face redirects to its CDN). The initial URL must be an
  `https://huggingface.co/` URL from the catalog; integrity comes from the SHA-256 check.
- **Disk space:** before starting or resuming, `fs.promises.statfs` free space must be at least
  `remaining × 1.05 + 200 MB`. Otherwise fail with 「硬碟空間不足：需要 X，剩下 Y」.
- **Verify:**
  - when bytes reach `size`, compare the SHA-256;
  - on a match, rename atomically into `<userData>/models/<fileName>` (same volume) and remove the
    sidecar;
  - on a mismatch, delete the partial and fail with 「檔案校驗失敗，請重新下載」;
  - more bytes than `size` is also a failure.
- **Progress:** state is `idle | downloading | verifying | completed | failed | cancelled`, with
  `receivedBytes`, `totalBytes`, `bytesPerSecond` (moving average over about 3 s), `etaSeconds`
  and `error`.
  - Main → renderer event `models:download-progress`, throttled to 4 per second plus every state
    change.
  - The renderer sees keys and names only, never paths.
- **Network errors:** fail with 「下載中斷，可以稍後繼續」 and keep the partial.
  - A 30 s stall timeout with no bytes received triggers the same failure.
  - No automatic retry loop.
- **App quit:** abort the download and keep the partial. Nothing is persisted beyond the partial
  file and its sidecar.
- **Logs:** key, sizes, durations and errors only.

## Catalog state
`models:catalog` returns each entry plus:
- `installed`: a file named `fileName` exists in the app folder with exactly `size` bytes, or in
  `~/whisper.cpp/models` with exactly `size` bytes. Report its `modelId` (`app/…` or
  `whisper.cpp/…`).
- `partialBytes`, when a matching partial exists.
- `active`: true when it is the running or selected model.

Listing does not re-hash installed files.

## Delete
- `models:delete(modelId)` deletes **app-folder** models only, never `~/whisper.cpp`.
- The id must pass the existing pattern, and the file must be inside the app folder after
  `path.resolve`.
- When it is the selected `asr.model`, set it to `null` first (automatic). The existing settings
  subscription restarts the server.

## IPC (role `main`; zod-validated keys)
- `models:catalog`
- `models:download-start` (key)
- `models:download-cancel`
- `models:download-discard` (key)
- `models:delete` (modelId)
- event `models:download-progress`

Expose all of them in the main preload as `window.api.models`.

## UI (語音辨識 section, new card 「下載模型」)
- One row per catalog entry, with a 推薦 badge on the entry matching `asr.language`: `yue` →
  cantonese, otherwise general. Each row shows the title, size, license, credit and description.
- **Not installed:**
  - 「下載」 button, or 「繼續下載（N%）」 when a partial exists;
  - 「捨棄」 link next to it when a partial exists.
- **Downloading:** progress bar (`model-download-progress`, CSS only), `X / Y`, speed, ETA, and a
  「取消」 button. Other download buttons are disabled meanwhile.
- **Verifying:** 「正在驗證檔案…」.
- **Installed:**
  - 「已安裝」 with its location (app / whisper.cpp);
  - 「使用這個模型」 when it is not active, which sets `asr.model`;
  - 「刪除」 for app-folder models only, behind a confirmation dialog that names the file and size.
- **Errors:** shown inline on the row, with 「重試」.
- After a download completes, the app-folder model list and the 辨識模型 select refresh
  automatically.

## Acceptance criteria
- [ ] Unit tests (a fake HTTP server on loopback serving a small deterministic file whose SHA-256
  is computed in the test; catalog values injected):
  - fresh download and verify;
  - resume with 206, including the hash over existing bytes;
  - a server that ignores Range (200) restarts;
  - SHA-256 mismatch deletes the partial;
  - oversize file fails;
  - cancel keeps the partial;
  - stall timeout;
  - insufficient disk space (injected statfs);
  - a second concurrent start is rejected;
  - redirect followed;
  - non-catalog key rejected;
  - delete path containment;
  - deleting the selected model resets `asr.model`;
  - catalog installed/partial/active flags;
  - progress throttling;
  - IPC names only.
- [ ] Integration (UI, with a catalog override for tests through env `OPEN_TYPELESS_MODEL_CATALOG`
  pointing to a JSON file whose URLs point at a local fake server; the override is honored **only**
  when `!app.isPackaged`):
  - download completes and shows 已安裝, 使用這個模型 sets the setting, and 刪除 asks then removes;
  - cancel then 繼續下載 resumes;
  - no CSP violations.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
