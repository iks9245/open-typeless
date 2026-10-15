# 口頭禪報告（Speech habits report）

## Goal
A 「報告」 tab that turns dictation history into a playful, private weekly report: how much you
dictated, the time you saved, your filler words and self-corrections, your busiest hours and most
used words. Everything is computed locally from history. An optional AI comment receives only
aggregate numbers, never the text.

## Data
Read `transcriptions` rows with `status = 'completed'` and `createdAt` in range:
`id`, `createdAt`, `mode`, `rawText`, `finalText`, `audioDurationMs`, `latencyMs`.
- A row is **polished** when `mode = 'dictation'` and `rawText !== finalText`.
- Command rows count toward activity totals, but are excluded from filler, correction and word
  statistics, because their raw text is an instruction.

## Ranges
- `week`: the last 7 days, compared with the 7 days before.
- `month`: the last 30 days, compared with the 30 days before.
- `all`: all time, with no comparison.

`now` is injected for tests. Hour buckets use the local timezone.

## Metrics (`src/main/services/report/lib/*.ts`, pure functions)
- **Totals:**
  - `dictations`, `commands`;
  - `characters`: code points of `finalText`, whitespace excluded;
  - `speakingMs`: sum of `audioDurationMs`.
- **Speed:** `charactersPerMinute = characters / (speakingMs / 60000)`, or `null` when
  `speakingMs` is 0.
- **Time saved:** `typingMs = characters / 40 × 60000`, an estimated typing speed of 40
  characters per minute, stated in the UI. `savedMs = max(0, typingMs − speakingMs − Σ latencyMs)`.
- **Fillers** (fixed lexicon in `lib/fillers.ts`):
  - Chinese: 嗯, 呃, 啊, 欸, 那個, 就是, 然後, 其實, 基本上
  - Cantonese: 即係, 嗰個, 呢個, 咁樣
  - English, case-insensitive, whole words: um, uh, like, you know, basically, actually

  For each term:
  - `spoken`: occurrences in `rawText` over dictation rows;
  - `removed`: over polished rows, `max(0, count(raw) − count(final))`.

  Matching rules:
  - Count CJK terms by non-overlapping substring.
  - Count English terms with word boundaries.
  - Count 嗯/呃/啊/欸 only as standalone interjections: not adjacent to another CJK character,
    except at the start of the text or next to punctuation or whitespace. For example, 「嗯那個」
    at the start counts 嗯, but 啊 inside 「是啊」 does not.

  Report the top 8 by `spoken`, with `total` and `removedTotal`.
- **Self-corrections:** occurrences in `rawText` of 不對, 我是說, 應該是, 講錯, 唔係, 我意思係.
- **Busiest hours:** 24 buckets of dictation counts; report the peak hour.
- **Weekday activity:** 7 buckets, Monday first.
- **Most used words:**
  - segment `finalText` with `Intl.Segmenter('zh-Hant', { granularity: 'word' })`;
  - keep `isWordLike` segments that are CJK with 2 or more characters, or Latin with 3 or more
    letters (lowercased);
  - drop a stopword list and the filler lexicon;
  - report the top 10 with counts.
- **Comparison:** for week and month, `previous` holds dictations, characters and savedMs for the
  prior period.
- **Headline:** a deterministic Traditional Chinese sentence picked from the data. For example,
  「你這週說了 132 次『那個』，AI 幫你刪掉了 120 次。」, or, without fillers,
  「你這週聽寫了 3,210 字，大約省下 42 分鐘。」 With no data: 「這段期間還沒有聽寫紀錄。」

## Service and IPC
- `reportService.build({ range })` returns a renderer-safe `SpeechReport`: aggregates, top words
  and filler counts. It contains no row text or ids.
- Channel `report:get` (role `main`, zod-validated range).
- Channel `report:comment`: runs a playful commentary with the command model from settings
  (`command.model`) through the existing oMLX client.
  - Thinking is disabled.
  - The prompt holds **only** the numbers, top filler terms and counts, and the peak hour.
    Top words are excluded because they may reveal content.
  - System prompt: 「你是幽默但友善的說話教練。根據這份聽寫統計，用繁體中文寫 2–3 句輕鬆的點評和一個小建議。不要捏造數字。」
  - The reply is at most 200 tokens, with a 30 s timeout.
  - Returns `{ text } | { error }`. Errors use the same known-message filtering as the command
    service. No OpenCC.
- When history is disabled, `report:get` still answers from existing rows. The UI shows a note
  that new dictations are not being recorded.

## UI (`ReportPanel`, tab 「報告」 between 歷史紀錄 and 詞彙表)
- Range selector (本週 / 本月 / 全部), `data-testid="report-range"`.
- Headline (`report-headline`).
- Stat cards (`report-stat-*`):
  - 聽寫次數
  - 字數
  - 說話時間
  - 省下時間, with the note 「以每分鐘打 40 字估算」
  - 語速（字／分鐘）
  - Each card shows its change against the previous period when available (▲ / ▼).
- Filler ranking (`report-fillers`): horizontal CSS bars, spoken count plus 「AI 刪掉 N 次」.
  Note: 「『那個』『就是』也可能是正常用法，數字僅供參考。」
- Self-corrections count (`report-corrections`).
- Busiest hours chart (`report-hours`): 24 CSS bars, peak highlighted, hour labels every 6 hours.
- Weekday chart (`report-weekdays`).
- Top words chips (`report-words`).
- 「讓 AI 評一評」 button (`report-comment`):
  - disabled while oMLX is unavailable (reuse the polish status hook);
  - shows a spinner, then the comment (`report-comment-text`), or an error.
- Empty state when there are no rows. The report refreshes when history changes (`history:changed`)
  while the tab is active.
- Only CSS and SVG are used, with no chart library. Charts respect the existing dark mode and the
  strict CSP (no inline style attributes from HTML; React style props are fine).

## Acceptance criteria
- [ ] Unit tests:
  - filler counting: CJK substring, standalone interjections, English word boundaries,
    removed = raw − final clamped;
  - corrections;
  - totals, speed and saved time;
  - ranges and comparison with an injected now;
  - hour and weekday buckets in local time;
  - word segmentation, stopwords and limits;
  - headline variants;
  - command rows excluded from text statistics;
  - the comment prompt contains no row text (assert against seeded texts);
  - IPC schema.
- [ ] Integration (main-window): seed history rows, open 「報告」, check the headline, cards,
  filler ranking, hours chart and words; switch the range; empty state; comment button disabled
  without oMLX; no CSP violations.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
