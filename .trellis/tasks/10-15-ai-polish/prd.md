# AI 潤稿（oMLX）

## Goal
Optionally clean up each dictation with a local LLM served by oMLX before it is inserted:
remove fillers and repetitions, add punctuation, keep only the corrected part of self-corrections,
convert Chinese to Traditional, keep English, proper nouns and Cantonese wording. Text never leaves
the machine. Off by default.

## Experiment summary (2026-10-15, M4 Max, oMLX 127.0.0.1:11123, temperature 0, thinking off)
| Model | Warm latency / sentence | Passed |
|---|---|---|
| Qwen3.5-0.8B-4bit | ~0.25 s | 4/11, unusable |
| Qwen3.5-9B-4bit (default) | 0.6–0.8 s | 10/11 |
| Qwen3.6-35B-A3B-oQ4e-mtp | 0.45–0.6 s | 9/11, unstable (no Traditional conversion, missing punctuation) |
| Qwen3.8-27B-oQ4e-mtp (high quality) | 1.8–2.2 s | 11/11 |

Findings that the implementation must follow:
- Qwen3 thinking must be disabled with `chat_template_kwargs: { enable_thinking: false }`; otherwise
  the model emits hundreds of tokens of reasoning (0.3 s → 9 s).
- Without delimiting, every model executed dictated instructions ("幫我把這段翻譯成英文" was
  translated). Wrapping the transcript in `<transcript>` tags plus one example in the system prompt fixed it.
- Polishing can fail; the raw transcript must then be inserted unchanged.

## Requirements

### Settings
- `polish: { enabled: boolean; model: string }`, defaults `{ enabled: false, model: 'Qwen3.5-9B-4bit' }`.
- Dotted keys `polish.enabled`, `polish.model` (model: trimmed, 1–200 chars).

### oMLX discovery (`src/main/services/polish/lib/omlx-config.ts`)
- Read `process.env.OMLX_SETTINGS_PATH ?? ~/.omlx/settings.json` on every use.
- `server.port` must be an integer 1–65535, else not installed.
- `auth.api_key`: non-empty string or null.
- Base URL is always `http://127.0.0.1:<port>/v1`. `server.host` is ignored, so the key is only ever
  sent to loopback.
- The API key is never logged, returned over IPC, persisted, or included in error messages.

### Prompt (`lib/prompt.ts`)
The system prompt is the one validated by the experiment (round 2) and is kept verbatim.
Optionally append a vocabulary line built from `asr.vocabulary`. The user message is
`<transcript>…</transcript>`; any `<transcript>`/`</transcript>` inside the text is removed first.

### Output checks (`lib/sanitize.ts`)
Strip `<think>…</think>`, stray `<transcript>` tags, and wrapping quotes the raw text did not have.
Reject (fall back to raw text) when:
- the output is empty;
- it is longer than `1.5 × raw + 20` characters (counted as code points);
- the raw text has ≥ 20 characters and the output is shorter than `0.3 × raw`.

### Client and service
- `GET /models`, `POST /chat/completions` with `temperature: 0`, `stream: false`,
  `chat_template_kwargs: { enable_thinking: false }`. `Authorization: Bearer` only when a key exists.
- `status()` returns `{ available, reason: 'not-installed' | 'unreachable' | 'unauthorized' | null, models }`
  with a 3 s timeout.
- `polish()` never throws. Timeout `min(15000, 4000 + 25 × chars)` ms.
- `warmUp(model)` is fire-and-forget: one request in flight per model, skipped within 60 s of a
  successful warm-up. It runs on key-down when polish is enabled, at startup when enabled, and when
  polish is switched on or its model changes.

### Traditional Chinese safety net
Accepted output that still contains Simplified-only characters is converted with OpenCC (`cn` → `tw`).
Text without such characters, including Traditional and Cantonese text, is never changed, and the common 台 is kept.

### Push-to-talk
When enabled and the transcript is non-empty, the floating window stays in `processing` while the
text is polished. The polished text is shown, inserted, and stored as `finalText`; `rawText` keeps
the whisper output; `latencyMs` includes polish time.

### UI
Settings gets an 「AI 潤稿」 section between 語音辨識 and 輸入:
- an on/off switch, disabled while oMLX is unavailable unless polish is already on;
- a model select: recommended models first, then the other installed models; a saved model that is
  not installed is still shown;
- an oMLX status line;
- latency and fallback help text.

History items whose `rawText` differs from `finalText` show a 「已潤稿」 badge and an expandable
「原始辨識」 block.

## Acceptance Criteria
- [ ] Unit tests: prompt, sanitize, omlx-config (key never logged), service against a fake oMLX
      HTTP server (headers, body, timeout and error fallback, status reasons, warm-up dedupe), settings.
- [ ] Integration: push-to-talk with a fake oMLX inserts polished text and records raw and final
      text; an oMLX failure inserts the raw text; the settings panel shows the not-installed state.
- [ ] The integration runner points `OMLX_SETTINGS_PATH` at a temp path, so tests never read the real oMLX config.
- [ ] typecheck, lint, test:unit, test:integration pass.
