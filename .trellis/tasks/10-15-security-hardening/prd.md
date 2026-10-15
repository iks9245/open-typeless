# Electron security hardening

## Goal
Reduce what a compromised renderer could do before command mode lets the app execute
spoken instructions. Both renderers load only local, bundled code; the policy should
reflect that.

## Findings (2026-10-15)
1. No Content-Security-Policy in `index.html` or `floating.html`.
2. DevTools open whenever `NODE_ENV !== 'production'`. The packaged app does not set
   `NODE_ENV`, so DevTools open in production builds.
3. The floating window is not sandboxed (`sandbox` is unset).
4. `will-navigate` allows any `file://` URL. A navigated page would keep `window.api`.
5. `isTrustedSender` accepts any `file://` frame, including subframes, and does not tie
   requests to our own windows.
6. ASR start/stop and floating show/hide IPC have no sender check. `asr:start` accepts
   `serverUrl` from the renderer, which could redirect recorded audio to any host. No
   renderer calls start, stop, show or hide.
7. Both windows share one preload that exposes every API. The floating window needs only
   ASR events and `setContentHeight`.
8. No permission handlers: every permission request falls back to Electron's defaults.
9. `setContentHeight` accepts any value.

## Requirements

### CSP (build output only; the Vite dev server needs inline scripts for React refresh)
A shared Vite plugin (`apply: 'build'`, `transformIndexHtml`) injects this into both pages:
`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`
If the built UI needs more, allow only the specific source and record why.

### Windows
- Floating window: `sandbox: true`.
- DevTools open only when `!app.isPackaged && process.env.OPEN_DEVTOOLS !== '0'`.
- Navigation: each window may only navigate to the exact URL it loaded (reloads).
  Everything else, including other `file://` URLs, is blocked. Apply the same rule to
  `will-redirect`.
- `app.on('web-contents-created')` sets a deny window-open handler on every web contents
  and prevents `will-attach-webview`.

### Trusted senders (`src/main/ipc/sender.ts`)
- Windows register with `registerTrustedWindow(webContents, role: 'main' | 'floating')`,
  and are unregistered on `destroyed`.
- `isTrustedSender(event, role)` requires all of:
  - `event.sender` is registered with that role;
  - `event.senderFrame` is the sender's main frame;
  - the frame URL is the URL that window loaded.
- Accept both `IpcMainEvent` and `IpcMainInvokeEvent`.
- History, settings, whisper-server status, polish status and `asr:send-audio`: role `main`.
- `floating-window:set-content-height`: role `floating`. The value must be a finite number,
  clamped to 0–2000.

### Remove unused IPC
Remove the `asr:start`, `asr:stop`, `floating-window:show` and `floating-window:hide` channels,
their handlers and their preload API. Keep the main-process procedures (tests use them).

### Preload split
- `src/preload.ts` (main window): asr `sendAudio`, `onStatus`, `onResult`, `onError`; history;
  settings; whisperServer; polish.
- `src/preload-floating.ts`: asr `onStatus`, `onResult`, `onError`; `floatingWindow.setContentHeight`.
- Add a Forge build entry for the new preload and update the renderer typings.

### Permissions (`src/main/security/permissions.ts`)
A pure decision function plus an installer for the default session:
- `media` is allowed only for the main window, and only when every requested media type is
  `audio`.
- `clipboard-sanitized-write` is allowed for the main window.
- Everything else is denied.
- Permission checks follow the same rule.

## Acceptance criteria
- [ ] Unit tests: the sender check (role, subframe, URL mismatch, unregistered,
      destroyed), the permission decision, and `setContentHeight` validation.
- [ ] Integration: the main-window UI test records no `securitypolicyviolation` events and
      checks that `window.api` has no `asr.start` or `floatingWindow` keys.
- [ ] Integration: a test page that is not registered gets `Untrusted sender`.
- [ ] `verify:package` checks that the packaged HTML contains the CSP meta tag.
- [ ] typecheck, lint, test:unit, test:integration, package and verify:package pass.
