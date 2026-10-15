# 指令模式（Command mode）

## Goal
Hold **Shift + Right Option** and speak an instruction. If text is selected, it is rewritten
according to the instruction (改成正式語氣、翻譯成英文、整理成條列…) and replaced in place.
With no selection, the generated text is inserted at the cursor (「寫一封 email 給老闆說我明天請假」).
The LLM only produces text: it has no tools, and nothing it outputs is executed.

## Decisions (user, 2026-10-15)
- Trigger: Shift + Right Option. Plain Right Option stays dictation.
- No selection: generate text and insert it at the cursor.
- Model: separate setting, default `Qwen3.8-27B-oQ4e-mtp`. Polish keeps its own model.

## Requirements

### Settings
`command: { enabled: boolean; model: string }`, defaults `{ enabled: true, model: 'Qwen3.8-27B-oQ4e-mtp' }`.
Dotted keys are `command.enabled` and `command.model`. When disabled, Shift + Right Option is
treated as ordinary dictation.

### Keyboard (`KeyboardService`)
- The mode is decided at trigger key-down: Shift (left or right) held means `command`,
  otherwise `dictation`.
- `onKeyDown` receives the mode. Existing callers and tests that call
  `handleKeyDown(keycode)` keep working (mode `dictation`).
- Track the physical Shift state from uiohook keydown/keyup events. Add
  `waitForModifiersReleased(timeoutMs): Promise<boolean>`, which resolves true once neither
  Shift nor Option is held.

### Selection capture (`src/main/services/command/lib/selection.ts`, injectable deps)
1. Wait for modifiers to be released (up to 1500 ms). Otherwise fail with
   `Release Shift to run the command`, because Cmd+C with Shift held is a different shortcut.
2. Snapshot the clipboard: text, html, rtf, image, and the formats list.
3. Write a unique sentinel string.
4. Tap Cmd+C (`uIOhook.keyTap(UiohookKey.C, [UiohookKey.Meta])`).
5. Poll the clipboard every 20 ms for up to 400 ms:
   - text that is no longer the sentinel → that text is the selection;
   - still the sentinel → there is no selection (`null`).
6. Always restore the snapshot in `finally`, with `clipboard.write({ text, html, rtf, image })`,
   or `clear()` if it was empty. When formats other than these were present, log a warning with
   the format names only.

Known limitation: editors that copy the whole line on Cmd+C with an empty selection (VS Code)
will report that line as the selection.

### Prompts (`src/main/services/command/lib/prompt.ts`)
- **With a selection.** System prompt:
  「你是文字編輯工具。依照使用者的口述指令，修改 <selection> 內的文字。只輸出修改後的完整文字，不要加上說明、標籤或引號。指令沒有指定語言時，維持原文的語言；中文使用繁體中文。」
  User message: `<instruction>…</instruction>\n<selection>…</selection>`.
- **Without a selection.** System prompt:
  「你是寫作助手。依照使用者的口述指令，產生要插入文件游標處的文字。只輸出要插入的文字本身，不要加上前言、說明、標籤或引號。中文使用繁體中文。」
  User message: `<instruction>…</instruction>`.
- Strip the tag names from the inputs before wrapping them.
- Thinking is disabled and temperature is 0.
- `max_tokens`: with a selection, `min(4096, selectionCodePoints × 3 + 256)`; without one, `1024`.
- Timeout: `min(90000, 15000 + 40 × maxTokens)` ms.

### Output
- Strip `<think>…</think>`, stray tags and wrapping quotes, reusing the polish sanitize helpers.
- Empty output is an error.
- No length check and no OpenCC: the instruction may ask for Simplified Chinese or a different length.

### Flow (push-to-talk)
- **Key-down in command mode:**
  - begin history with `mode: 'command'`;
  - warm up `command.model`;
  - tell the floating window the mode (new channel `floating-window:mode`, exposed in the
    floating preload as `onMode`). It shows 「指令模式」 while listening and processing.
- **Key-up:**
  - stop ASR (floating window stays `processing`) and capture the selection in parallel;
  - empty instruction → nothing happens, the row is `empty`;
  - otherwise run the command. On success, insert the output (typing replaces the selection),
    show it in the floating window, and record `rawText` = instruction, `finalText` = output.
- **Failure** (oMLX missing or unreachable, timeout, empty output, selection capture error):
  - insert **nothing** (inserting the raw instruction would replace the user's selection);
  - show `指令失敗：<reason>` in the floating window;
  - history fails with `command_failed`.
- The selected text is never stored in history or logs.
- Short-press cancel works the same as in dictation.

### UI
- **Settings:** an 「指令模式」 section after AI 潤稿, containing:
  - an on/off switch (`settings-command-enabled`);
  - a model select (`settings-command-model`) using the same options helper, with 27B listed first;
  - help text: 「按住 Shift + 右 Option 說出指令。有選取文字時依指令改寫並取代；沒有選取時在游標處插入產生的文字。每次約需 2–10 秒。」
  - shared oMLX availability: when oMLX is unavailable, the switch is disabled unless the mode is already on.
- **History:** items with mode `command` show a 「指令」 badge. The row text shows the output, and
  an expandable 「口述指令」 block shows the instruction.
- **Failure filter:** explains `command_failed` in Chinese.

## Acceptance criteria
- [ ] Unit tests:
  - keyboard mode detection and `waitForModifiersReleased`;
  - selection capture with fake clipboard and keyTap: selection found, no selection, modifier
    timeout, restore always happens including on error, warning for unknown formats;
  - prompts;
  - command service against a fake oMLX HTTP server: body, timeout, error, empty output;
  - settings.
- [ ] Integration (push-to-talk, fake oMLX, selection reader stubbed):
  - selection plus instruction → output inserted, `mode` is `command`, raw and final text recorded,
    the selection is not in history;
  - no selection → generated text inserted;
  - oMLX error → nothing inserted and the row fails with `command_failed`;
  - command disabled → Shift + Right Option dictates normally.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
