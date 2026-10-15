# 自訂快捷鍵 + 開機自動啟動

## Goal
Let the user choose the push-to-talk key, and start the app at login. Also make the app keep
working without its main window on screen: today, closing the main window silently breaks
dictation.

## Findings (2026-10-15)
- **Closing the main window breaks dictation.** Audio is recorded in the main window's renderer.
  Closing the window destroys it, but the floating window survives, so `activate` (Dock click)
  does not recreate the main window. Push-to-talk then sends `listening` to the floating window,
  which does not record, and every dictation ends up silent.
- "Right Option" is hard-coded in `KeyboardService`, the accessibility dialog and several UI
  strings (App footer, HistoryPanel empty state, command help, floating `StatusIndicator`).
- The `KeyboardService` modifier tracking covers only Shift and Option.

## Requirements

### Trigger key setting
- `input.triggerKey`: `z.enum`, default `'right-option'`. Shared constant `TRIGGER_KEYS`
  (`src/shared/constants/keyboard.ts`) holds `{ id, label, keycode }`:

  | id | label | uiohook keycode |
  |---|---|---|
  | `right-option` | 右 Option | 3640 |
  | `right-command` | 右 Command | 3676 |
  | `right-control` | 右 Control | 3613 |
  | `left-option` | 左 Option | 56 |
  | `f13` | F13 | 91 |
  | `f14` | F14 | 92 |
  | `f15` | F15 | 93 |

  Shift keys and Caps Lock are not offered: Shift is the command-mode modifier, and Caps Lock
  toggles state.
- Command mode remains Shift + trigger key.
- `KeyboardService.setTriggerKey(keycode)` applies the change at runtime. If the key is held
  at that moment, the change applies after release.
- Push-to-talk subscribes to settings changes and applies the trigger key on startup.

### Interruption rule (prevents conflicts with shortcuts such as Cmd+C on Right Command)
- While the trigger is held, a keydown of any key other than Shift, Shift Right, or the trigger
  itself (auto-repeat) cancels the session through the existing `onCancel` path: nothing is
  transcribed or inserted, and the row is removed.
- The trigger's later key-up is then ignored.

### Modifier tracking
- Track Shift, Ctrl, Alt and Meta (both sides).
- `waitForModifiersReleased` waits for all of them.
- The `syncModifiers` resync from ordinary key events also uses `ctrlKey` and `metaKey`.

### Main window lifecycle (`src/main/windows/main-window.ts`)
- Move main-window creation out of `main.ts`.
- `backgroundThrottling: false`, because the window records audio while hidden.
- Closing the window hides it instead of destroying it, unless the app is quitting (a flag set
  in `before-quit`). The hide-on-close behavior lives in an exported helper so tests can apply
  it to their window.
- `activate` (Dock click) shows the main window, recreating it only if it was really destroyed.
- `sender.ts` keeps a role → webContents map and exports `getTrustedWebContents(role)`.
  Push-to-talk sends the recording start/stop notifications to the `main` role only, never to
  "the first window".

### Launch at login (OS state is the source of truth, not the settings DB)
- IPC `system:get-login-item` returns `{ supported, enabled, requiresApproval }`, where
  `supported = app.isPackaged && process.platform === 'darwin'`.
- IPC `system:set-login-item` takes a boolean, validated with zod, and returns the fresh state.
- Both channels are restricted to the `main` role. The logic lives in a small service with
  injected `app` functions so it can be unit-tested.
- On macOS, `requiresApproval` comes from `getLoginItemSettings().status === 'requires-approval'`
  when that field exists.
- When the app was opened at login (`wasOpenedAtLogin`), the main window is created hidden.
  Dictation still works, and a Dock click shows the window.
- Expose both calls in the main preload as `window.api.system`.

### UI
- In the 「輸入」 settings section:
  - 「聽寫快捷鍵」 select (`settings-trigger-key`) with help text
    「按住這個鍵聽寫；同時按住 Shift 為指令模式。按住期間按下其他按鍵會取消聽寫，避免和快捷鍵衝突。」
  - 「開機時自動啟動」 switch (`settings-launch-at-login`):
    - disabled when unsupported, with detail 「只有打包後的 app 支援。」
    - when approval is required, a note 「請到「系統設定 → 一般 → 登入項目」允許 Open Typeless。」
- Text that names the trigger key uses the selected key's label: the App footer, the
  HistoryPanel empty state, and the command help (「按住 Shift + 右 Command …」).
- The floating `StatusIndicator` idle label becomes 「準備就緒」, since the floating window has no
  settings API.
- The accessibility dialog says "the push-to-talk key" without naming one.

## Acceptance criteria
- [ ] Unit tests:
  - keyboard: `setTriggerKey` (including while held), F-key trigger, interruption cancels and
    ignores the later key-up, Shift does not interrupt, Ctrl/Meta tracking and resync;
  - settings: default and validation;
  - login-item service with a fake app: supported/unsupported, `requiresApproval`, set;
  - the trigger-key label helper.
- [ ] Integration:
  - push-to-talk: changing `input.triggerKey` in settings updates `keyboard.config.triggerKey`,
    and a session works with the new key;
  - pressing another key while the trigger is held cancels with no insertion and no row;
  - recording notifications go to the main-role window even when another window was created first.
- [ ] Integration (UI):
  - the trigger select lists the keys and saves;
  - footer text follows the selection;
  - the login switch is disabled with the unsupported note (tests are not packaged);
  - hide-on-close: closing the window hides it and keeps it alive.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
