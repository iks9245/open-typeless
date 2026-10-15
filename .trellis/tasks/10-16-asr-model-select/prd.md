# 辨識模型選擇

## Goal
Let the user choose which whisper.cpp model the app-managed server runs. Ship-ready support for
the Cantonese fine-tune `large-v3-cantonese` (q8_0), which writes colloquial Cantonese directly.

## Evaluation (2026-10-15)
Twelve synthetic Cantonese sentences (macOS voice Sinji):

| model | CER | colloquial markers kept | per sentence |
|---|---|---|---|
| ggml-large-v3-turbo (current) | 37.9% | 2% | 0.25 s |
| whisper-small-cantonese (alvanlii) | 23.3% | 89% | 0.11 s — prefixes hallucinations (laa, Loom, 對啊) |
| large-v3-cantonese q8_0 (kiuckhuang, from khleeloo) with `yue` | 3.4% | 98% | 0.40 s |
| large-v3-cantonese q8_0 with `-l auto` | 3.4% | 98% | 0.66 s |

Other languages with `large-v3-cantonese`:
- **English**: correct with both `auto` and `yue`.
- **Mandarin**: correct with `auto`; with `yue` it is forced into Cantonese with errors.

Real voice, one 68 s recording:
- `large-v3-cantonese` with `auto` produced fully colloquial text: 佢唔單只能夠聽你嘅說話啦 / 你問佢聽日天氣點啦 / 冇辦法執行其他嘅動作.
- Turbo produced standard written Chinese.
- Time: 3.0–3.3 s versus 1.5 s.

Recommendation: `large-v3-cantonese` with `-l auto`, and polish style 一般 (standard polish keeps
Cantonese and adds punctuation).

## Requirements

### Model sources and listing (`src/main/services/whisper-server/lib/models.ts`, pure with injected fs)
- **Sources:**
  - `app`: `<userData>/models`, created on demand;
  - `whisper.cpp`: `~/whisper.cpp/models`.
- **A model is** a regular file `*.bin` whose first 4 bytes are the ggml magic `lmgg`
  (`0x67676d6c` little-endian). Excluded:
  - names starting with `for-tests-`;
  - silero VAD models (`ggml-silero-*`);
  - `*-encoder.mlmodelc` and other directories.
- **Model id**: `${source}/${fileName}`, for example `app/ggml-large-v3-cantonese-q8_0.bin`.
- **`listModels()`** returns `{ id, source, fileName, sizeBytes }[]`, sorted by source (`app` first),
  then name. Unreadable directories are skipped.
- **Renderer-safe** `WhisperModelInfo` has the same fields: names only, never paths.

### Setting
- `asr.model`: `string | null` (model id), default `null`, meaning automatic (today's priority list).
- Validate the format `^(app|whisper\.cpp)/[^/\\]+\.bin$`.

### Discovery
- Precedence: env `WHISPER_MODEL_PATH` > `asr.model` (when its file exists and passes the magic
  check) > automatic.
- If the selected model is missing or invalid, fall back to automatic, log a warning, and expose
  `modelFallback: true` in the status (renderer shows 「找不到選擇的模型，暫時使用自動選擇」).
- The VAD logic is unchanged.

### Restart on change
- `WhisperServerService.restart()` is `stop()` then `start()`, serialized with the existing tasks.
- On settings change, when `asr.model` changed:
  - mode managed or adopted → restart;
  - mode external → no restart; the status explains it.
- **Adoption:** when the adopted process's command line `-m` path differs from the model the
  current settings resolve to, stop it and launch a managed one. Use the existing ownership
  `commandOf`; parse its `-m` argument.
- Dictation during a restart already waits up to 30 s for `starting`, which is unchanged.
- `WhisperServerInfo` gains:
  - `modelId: string | null` (id of the running model when known);
  - `modelFallback: boolean`;
  - `modelLocked: 'env' | 'external' | null`.

### IPC (role `main`)
- `whisper-server:models` → `IpcResult<WhisperModelInfo[]>`.
- `whisper-server:open-models-folder` → creates `<userData>/models` if missing and opens it with
  `shell.openPath`. No path is returned.

### UI (語音辨識 section)
- **Select 「辨識模型」** (`settings-asr-model`):
  - first option 「自動（目前：{modelName}）」;
  - then each model as `{fileName}（{size}）`, with source label 「app」 or 「whisper.cpp」;
  - disabled when `modelLocked` is set, with the reason:
    - `env`: 「已由 WHISPER_MODEL_PATH 指定」
    - `external`: 「伺服器不是由 app 啟動，無法切換模型」
- 「打開模型資料夾」 button (`settings-open-models-folder`).
- While the server restarts, the status line shows 「正在載入模型…」, using the existing status polling.
- **Hint** (`asr-model-language-hint`), shown when the selected or running model file name contains
  `cantonese` and `asr.language` is `yue`:
  「粵語模型配合「自動偵測」語言，普通話和英文也能正確辨識。」
- **Hint**, shown when the model name contains `cantonese` and the effective polish style is
  cantonese: 「粵語模型已直接輸出粵語口語，潤稿風格建議改為「一般」。」

### Docs
README: the model selection, the models folder, and a short paragraph recommending
`large-v3-cantonese` for Cantonese speakers with its source
(https://huggingface.co/kiuckhuang/whisper-large-v3-cantonese-ggml, Apache-2.0, converted from
khleeloo/whisper-large-v3-cantonese) and the evaluation numbers.

## Acceptance criteria
- [ ] Unit tests:
  - listing: magic check, exclusions, sort, unreadable dirs, sizes;
  - id validation;
  - discovery precedence and fallback;
  - adoption mismatch → relaunch, using the lifecycle test with the fake server fixture and asserting
    `-m` in args;
  - restart on setting change for managed, and not for external;
  - IPC returns names only;
  - settings.
- [ ] Integration (UI):
  - fake ggml files (magic plus padding) in `<userData>/models` appear in the select;
  - choosing one saves `asr.model`;
  - a non-ggml file is not listed;
  - the hints appear for a `*cantonese*` model;
  - no CSP violations.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
