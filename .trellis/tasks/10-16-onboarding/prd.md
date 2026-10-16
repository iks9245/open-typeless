# M3 首次啟動精靈

## Goal
A new user who opens the app for the first time ends up with a working dictation in a few minutes,
without reading the README. The wizard asks for the main language, downloads the right model,
walks through microphone and Accessibility permissions with live status, lets the user try one
sentence, offers the optional AI features, and finishes with the shortcuts. It can be resumed and
re-run.

## Requirements

### State (settings)
- `onboarding: { completed: boolean; step: OnboardingStep | null; primaryLanguage: 'yue' | 'zh' | 'en' | 'other' | null }`.
  - Default `{ completed: false, step: null, primaryLanguage: null }`.
  - `OnboardingStep = 'welcome' | 'model' | 'microphone' | 'accessibility' | 'try' | 'ai' | 'done'`.
- **Existing users are never sent through the wizard.** At startup after storage init, if no
  `onboarding.completed` row is stored and the history table has at least one row, write
  `onboarding.completed = true`. This is a one-time migration, done in
  `src/main/services/onboarding/`.
- The step is saved on every transition, so quitting mid-wizard resumes at the same step.

### Language → recommendations (pure helper in `src/shared/lib/onboarding.ts`)

| primaryLanguage | recommended catalog key | asr.language | polish.style |
|---|---|---|---|
| `yue` (粵語) | `large-v3-cantonese-q8_0` | `null` (自動偵測, keeps Mandarin and English correct) | `standard` |
| `zh` (普通話／國語) | `large-v3-turbo` | `null` | `standard` |
| `en` (English) | `large-v3-turbo` | `null` | `standard` |
| `other` | `large-v3-turbo` | `null` | `standard` |

Choosing a language applies `asr.language` and `polish.style` at once.

**Memory** (new IPC `system:info` → `{ totalMemoryGb }` from `os.totalmem()`, role `main`):
- below 8 GB, also suggest `large-v3-turbo-q5_0`, with a note;
- the AI step recommends Qwen3.8-27B for commands only at 32 GB or more, otherwise Qwen3.5-9B,
  with a note that commands are less reliable.

### Steps (main window full-window view `OnboardingWizard`, shown instead of the tabs while `!onboarding.completed`)
Every step has a progress indicator (`onboarding-progress`, 「第 N／7 步」), 「上一步」 (except the
first), and a primary button. Copy is in Traditional Chinese and short.

1. **welcome**: what the app does in one sentence, the privacy promise (「語音和文字都只在這台電腦處理」),
   and the language choice as large radio cards (`onboarding-language-*`).
2. **model**:
   - **Already installed**: if any catalog model is installed (`models:catalog`), show 「已安裝」 and
     preselect the recommended one if installed, otherwise the first installed. Its primary button
     「使用這個模型」 sets `asr.model`.
   - **Not installed**: show the recommended model card, with size, license and why, plus
     「其他選擇」 for the rest. 「下載」 uses the M2 download service and progress events, with
     cancel and resume.
   - **When the download completes**, set `asr.model` and enable 「下一步」.
   - 「稍後再說」 is allowed, with the warning 「沒有辨識模型時無法聽寫」.
3. **microphone**: live status, polled every 1.5 s.
   - `not-determined` → 「允許使用麥克風」 calls `requestMicrophonePermission`;
   - `denied` or `restricted` → explanation plus 「打開系統設定」 (`openSettings('microphone')`);
   - `granted` → auto-advance after 600 ms.
   - 「略過」 is allowed, with a warning.
4. **accessibility**: why it is needed (detecting the shortcut and typing text), live status
   polled every 1.5 s.
   - 「打開系統設定」 calls `getAccessibilityStatus(true)`, so the app is listed, then
     `openSettings('accessibility')`. The steps to turn it on are shown inline.
   - Granted → auto-advance. 「略過」 is allowed, with a warning.
5. **try**: 「按住 {觸發鍵} 說一句話，放開後文字會出現在下面。」 with a focused textarea
   (`onboarding-try-input`).
   - Show the whisper-server state: loading model, ready, or failed with its reason.
   - **Success** is a non-empty `onboarding-try-input` value, or a `history` change whose newest row
     completed in the last 60 s with non-empty `finalText`. Then show 「成功！」 and enable 「下一步」.
   - If the server is not ready or a permission is missing, list what is missing, with links back
     to that step.
   - 「略過」 is allowed.
6. **ai** (選用):
   - **When oMLX is available** (`polish:status`), offer switches for AI 潤稿 and 指令模式, plus the
     recommended models by memory, chosen from the installed models.
   - **When it is not available**, explain that the AI features need oMLX running on this Mac and
     can be enabled later in 設定.
   - 「下一步」 either way.
7. **done**:
   - the shortcuts: 聽寫 {鍵}, 指令 Shift + {鍵}, 提問 Control + {鍵};
   - 「開機時自動啟動」 switch when the login item is supported (M-B login-item service);
   - 「開始使用」 sets `onboarding.completed = true` and `step = null`.

### Other behavior
- **The startup Accessibility dialog** (`PushToTalkService.showAccessibilityGuidance`) is not shown
  while `!onboarding.completed`. The wizard handles it, and the hook polling still starts the
  keyboard hook once Accessibility is granted.
- **Opened at login**: if the app was opened at login while onboarding is incomplete, show the
  main window anyway.
- **Settings**: a new 「一般」 section at the top with 「重新執行設定精靈」
  (`settings-rerun-onboarding`). It sets `completed = false`, `step = 'welcome'`.
- **Accessibility of the UI**:
  - focus moves to the step heading on transition;
  - the wizard is keyboard-only operable;
  - the progress is announced politely;
  - dark mode works.
- **No new main-window permissions**: the wizard uses existing IPC plus `system:info`. If
  permission request or status IPC is needed, add a `permissions` IPC (role `main`):
  - `status` → `{ microphone, accessibility }`;
  - `requestMicrophone`;
  - `openSettings(type)`, zod-validated to `microphone` or `accessibility`.

## Acceptance criteria
- [ ] Unit tests:
  - recommendation helper for every language and memory threshold;
  - existing-user migration: history rows and no stored row → completed; a stored row is left
    alone; empty history → not completed;
  - step persistence and validation;
  - permissions IPC validation;
  - the accessibility dialog is suppressed while onboarding is incomplete.
- [ ] Integration (UI, fresh temp userData, fake model catalog server from the M2 tests):
  - the wizard appears instead of the tabs;
  - choosing 粵語 applies the language and style and recommends the Cantonese entry;
  - download completes and sets `asr.model`;
  - the permission steps can be skipped (the test environment denies the microphone);
  - try-step success is detected from text typed into the textarea;
  - the AI step shows the unavailable explanation (no oMLX in tests);
  - done → the tabs appear and `completed` is true;
  - reload resumes at the saved step;
  - re-run from settings shows the wizard;
  - no CSP violations.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
