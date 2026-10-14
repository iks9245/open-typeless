# 轉寫歷史與設定資料層

## 目標

為 open-typeless 加入本地資料層，讓每次 push-to-talk 的結果可被保存、查詢與管理，並把目前散落在環境變數的設定改為可在執行期修改。

**這一階段只做資料層與主程序整合**，不做主視窗 UI。UI 是下一個任務，會直接使用本任務提供的 IPC API。

## 依據

- Typeless 本地資料模型分析：`../typeless-parity-analysis/findings.md`
- 專案規範：`.trellis/spec/backend/directory-structure.md`、`error-handling.md`、`ipc-handler-registration.md`、`.trellis/spec/shared/native-module-packaging.md`
- 現有程式：`push-to-talk.service.ts`、`asr.service.ts`、`whisper-client.ts`、`preload.ts`、`forge.config.ts`、`vite.main.config.ts`

本設計**不複製** Typeless 的結構，只採用分析得出的經驗：音訊存檔案、易變資訊放 JSON、從第一天就用 migration、預留 mode 欄位、情境資料預設不收、先不做同步。

---

## 1. 設計原則

1. **歷史記錄絕不阻礙輸入**。資料庫或檔案寫入失敗只記 log，不能讓文字插入失敗或變慢
2. **資料庫打不開時，聽寫照常運作**。歷史功能降級為停用，並記錄原因
3. **只有主程序碰資料庫**。renderer 一律透過 IPC，所有輸入用 zod 驗證
4. **隱私預設保守**。不存音訊、不記錄前景應用，除非使用者開啟
5. **結構會變**。所有變更走 migration，不手改資料庫

## 2. 技術選擇

| 項目 | 選擇 | 理由 |
|---|---|---|
| SQLite 驅動 | `better-sqlite3` | 同步 API 適合主程序；drizzle 支援成熟；專案規範 `native-module-packaging.md` 已記錄其打包方法 |
| ORM 與 migration | `drizzle-orm` + `drizzle-kit` | 型別安全；migration 產生 SQL 檔，可放進打包資源 |
| 驗證 | `zod`（已有） | 與規範一致 |
| ID | `uuid` 的 v7（已有 `uuid@13`） | 依時間排序，索引局部性好，分頁穩定 |

**未採用 `node:sqlite`**：可避免原生模組打包問題，但我**沒有確認** drizzle 對它的支援現況，也沒確認 Electron 40 內建 Node 的狀態。若之後確認可用，可再評估替換。

## 3. 儲存位置

| 資料 | 位置 |
|---|---|
| 資料庫 | `app.getPath('userData')/open-typeless.db` |
| 音訊（選用） | `app.getPath('userData')/audio/YYYY/MM/<id>.wav` |
| Migration SQL | 開發：專案根目錄 `drizzle/`；打包後：`process.resourcesPath/drizzle` |

資料庫只存音訊的**相對路徑**（相對 `audio/`），避免 userData 位置改變後失效。

連線開啟後設定：`journal_mode = WAL`、`foreign_keys = ON`、`busy_timeout = 5000`、`synchronous = NORMAL`。

## 4. 資料結構

### 4.1 `transcriptions`

一列代表一次 push-to-talk 工作階段。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | text PK | uuid v7 |
| `created_at` | integer not null | Unix 毫秒，按下快捷鍵時 |
| `updated_at` | integer not null | Unix 毫秒 |
| `status` | text not null | 見 4.2 |
| `mode` | text not null default `'dictation'` | 預留 `'command'` 等未來模式 |
| `raw_text` | text | ASR 原始輸出 |
| `final_text` | text | 實際插入的文字；目前等於 `raw_text`，未來加後處理時才會不同 |
| `language` | text | 要求的語言（`zh`、`en`，null 為自動） |
| `detected_language` | text | 引擎回報的語言，取不到就是 null |
| `audio_duration_ms` | integer | 由 PCM 位元組數計算：`bytes / 2 / 16000 * 1000` |
| `latency_ms` | integer | 放開快捷鍵到取得最終結果的時間 |
| `engine` | text not null | `whisper.cpp` 或 `volcengine` |
| `engine_model` | text | 取得到才填 |
| `audio_path` | text | 相對路徑；未存音訊時為 null |
| `insert_status` | text | `inserted` / `failed` / `skipped` / null |
| `error_code` | text | 失敗時的錯誤代碼 |
| `error_message` | text | 失敗時的訊息 |
| `app_version` | text not null | `app.getVersion()` |
| `meta` | text（JSON） | 易變資訊，例如麥克風裝置、whisper 伺服器 URL |

索引：
- `idx_transcriptions_created_at` on `(created_at, id)`：列表與 keyset 分頁
- `idx_transcriptions_status_created_at` on `(status, created_at)`：篩選失敗記錄

不設前景應用欄位。若未來要做「依應用調整」，先以設定開關控制，資料放進 `meta`，確定需要再升級為欄位。

### 4.2 狀態機

```
recording ──► processing ──► completed
    │              │      └─► empty      （沒有辨識出文字）
    └──────────────┴────────► failed
```

| 狀態 | 何時設定 |
|---|---|
| `recording` | 按下快捷鍵，`begin()` 建立列 |
| `processing` | 放開快捷鍵，等待 ASR |
| `completed` | 取得非空文字 |
| `empty` | ASR 完成但沒有文字 |
| `failed` | 任何階段出錯，寫入 `error_code`、`error_message` |

**崩潰復原**：啟動時把所有停在 `recording` 或 `processing` 的列改為 `failed`，`error_code = 'interrupted'`。

### 4.3 `settings`

鍵值表，只存**使用者改過的值**，預設值寫在程式碼裡。

| 欄位 | 型別 |
|---|---|
| `key` | text PK |
| `value` | text（JSON） |
| `updated_at` | integer not null |

v1 的設定項（以 zod schema 定義於 `src/shared/types/settings.ts`）：

| key | 型別 | 預設 | 說明 |
|---|---|---|---|
| `history.enabled` | boolean | `true` | 關閉時不寫任何歷史 |
| `history.saveAudio` | boolean | `false` | 是否保存音訊 |
| `history.retentionDays` | number \| null | `null` | null 為永久保存 |
| `asr.language` | string \| null | 環境變數或 null | 取代 `WHISPER_LANGUAGE` |
| `asr.whisperServerUrl` | string | 環境變數或 `http://localhost:8080` | 取代 `WHISPER_SERVER_URL` |
| `input.autoInsert` | boolean | `true` | 取代 `PushToTalkConfig.autoInsertText` |

設定讀取順序：資料庫覆寫值 → 環境變數 → 程式預設。讀到無效值時記 log 並退回預設，不拋錯。

**不採用 `electron-store`**：既然已有 SQLite，用同一個儲存體可少一個依賴，也讓設定與歷史在同一份備份裡。

## 5. 程式結構

依 `.trellis/spec/backend/directory-structure.md`：

```
drizzle.config.ts
drizzle/                                 # drizzle-kit 產生，納入版本控制
src/main/db/
  client.ts                              # 開啟、pragma、單例、close
  schema.ts                              # transcriptions、settings
  migrate.ts                             # 啟動時執行 migration
src/main/services/history/
  types.ts                               # zod schema 與型別
  procedures/
    begin.ts                             # 建立 recording 列
    mark-processing.ts
    complete.ts                          # 寫入文字、時長、延遲、音訊
    fail.ts
    mark-inserted.ts
    list.ts                              # keyset 分頁 + 文字搜尋
    get.ts
    delete.ts                            # 同時刪音訊檔
    clear.ts
    recover.ts                           # 啟動時處理中斷的列
    prune.ts                             # 依 retentionDays 清理
  lib/
    audio-store.ts                       # 寫入與刪除 wav
  index.ts                               # historyService facade
src/main/services/settings/
  types.ts
  procedures/get.ts, update.ts
  index.ts
src/main/ipc/
  history.handler.ts
  settings.handler.ts
src/shared/constants/channels.ts         # 新增 HISTORY、SETTINGS
src/shared/types/history.ts
src/shared/types/settings.ts
src/preload.ts                           # 新增 history、settings API
```

## 6. 與現有流程整合

### 6.1 啟動與關閉（`src/main.ts`）

```
app ready
  ├─ initDatabase()           開啟 → migrate → recover → prune
  │     失敗：log error，historyAvailable = false，繼續啟動
  ├─ setupAllIpcHandlers()    （維持在 ready 前註冊亦可，handler 內檢查可用性）
  └─ createWindow()

before-quit
  └─ cleanup() 增加 closeDatabase()
```

### 6.2 ASR 需要多回傳的資訊

目前 `asrService.stop()` 只回傳 `ASRResult`。為了寫入歷史，需要：

| 資訊 | 來源 | 需要的修改 |
|---|---|---|
| 音訊時長 | `WhisperClient` 已在本地緩衝 PCM | 讓 client 暴露累積位元組數 |
| WAV 內容（只在 saveAudio 時） | `WhisperClient.buildWAV` 已存在 | 讓 client 在 finish 後可取出 WAV buffer |
| 延遲 | 在 `asrService.stop()` 內量測 | 新增計時 |
| 偵測語言 | whisper.cpp 回應 | 若回應有此欄位就取出；沒有就 null |

建議把 `stop()` 的回傳改為：

```ts
interface ASRSessionOutcome {
  result: ASRResult | null;
  audioDurationMs: number;
  latencyMs: number;
  detectedLanguage: string | null;
  wav: Buffer | null;        // 僅在呼叫端要求時提供
}
```

`stopASR` procedure 與 IPC 回傳保持不變，只改主程序內部介面。

### 6.3 Push-to-talk 的寫入點

```
handleKeyDown
  sessionId = history.begin({ mode, language, engine })     ← 失敗則 sessionId = null，繼續
  ...原流程...
  啟動失敗 → history.fail(sessionId, 'start_failed', msg)

handleKeyUp
  history.markProcessing(sessionId)
  outcome = asrService.stop()
  有文字：
    ...隱藏視窗、等待 100ms、插入文字...（原流程，順序不變）
    history.complete(sessionId, outcome, insertResult)      ← 插入之後才寫
  沒文字：
    history.complete(sessionId, outcome)  → status = empty
  例外：
    history.fail(sessionId, 'stop_failed', msg)
```

規則：
- 所有 `history.*` 呼叫包在 try/catch，失敗只記 log
- **歷史寫入一律在文字插入之後**，不增加使用者感受到的延遲
- `history.enabled = false` 時，`begin()` 直接回傳 null，其餘呼叫遇到 null 即略過
- 音訊檔寫入用非同步 API，完成後再更新 `audio_path`

## 7. IPC API

所有回應遵循 `error-handling.md`：輸入驗證失敗回 `{ success: false, error }`，資料完整性問題才拋錯。

| 通道 | 方向 | 輸入 | 輸出 |
|---|---|---|---|
| `history:list` | invoke | `{ cursor?, limit = 50 (≤200), query?, status? }` | `{ items, nextCursor }` |
| `history:get` | invoke | `{ id }` | 單筆或 null |
| `history:delete` | invoke | `{ id }` | `{ success }` |
| `history:clear` | invoke | `{}` | `{ success, deleted }` |
| `history:changed` | main → renderer | `{ id, kind: 'created' \| 'updated' \| 'deleted' \| 'cleared' }` | |
| `settings:get` | invoke | `{}` | 完整設定（含預設值） |
| `settings:update` | invoke | 部分設定 | 更新後的完整設定 |
| `settings:changed` | main → renderer | 完整設定 | |

設計細節：
- `cursor` 是 `(created_at, id)` 的編碼，不用 offset
- `query` v1 用 `LIKE` 搜 `final_text`；資料量大時再加 FTS5（需手寫 migration，drizzle 不直接建模虛擬表）
- **不把音訊絕對路徑傳給 renderer**。之後若要播放，用自訂 protocol 由主程序提供

## 8. 打包與建置變更

| 檔案 | 變更 |
|---|---|
| `package.json` | 依賴：`better-sqlite3`、`drizzle-orm`；開發依賴：`drizzle-kit`、`@types/better-sqlite3`；`pnpm.onlyBuiltDependencies` 加 `better-sqlite3`；新增腳本 `db:generate` |
| `vite.main.config.ts` | `external` 加 `better-sqlite3` |
| `forge.config.ts` | `nativeModules` 加 `better-sqlite3`、`bindings`、`file-uri-to-path`；`packagerConfig.extraResource` 加 `./drizzle` |
| `drizzle.config.ts` | 新增，dialect `sqlite`，schema 指向 `src/main/db/schema.ts`，out 為 `drizzle` |

## 9. 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| 打包後找不到 `better-sqlite3` | P0，app 無法啟動 | 依 `native-module-packaging.md` 設定；**必須**在打包後的 app 實測一次，不能只測 `pnpm start` |
| ~~`better-sqlite3` 與 Electron 40 的相容性~~ | — | **T1 已驗證**：v13.0.3 自帶 N-API prebuild（`prebuilds/darwin-arm64.node`），同一檔案在 Node 22.20（ABI 127）與 Electron 40.1.0（ABI 143）皆可載入並讀寫，SQLite 3.53.4 |
| ~~原生模組在純 Node 測試下無法載入~~ | — | 同上，N-API 不受 ABI 影響，單元測試可直接用 Node 跑 |
| Forge 的 `rebuildConfig.force` 會從原始碼重編 `better-sqlite3` | 啟動與打包變慢；執行期不使用該產物 | T8 實測 `pnpm start` 與 `pnpm package` 時確認；必要時用 `rebuildConfig.ignoreModules` 排除 |
| `@types/better-sqlite3@9.6` 對應較舊的 API | 少數型別不符 | v13 不自帶型別；T2 寫 client 時留意 |
| ~~既有：轉寫失敗時 `waitForFinalResult` 不監聽錯誤，要等 10 秒逾時才結束（T6 實測 10.3 秒）~~ | — | **已修正**：`waitForFinalResult` 收到 client 的 `error` 事件或 `error` 狀態即結束；失敗時 `cleanup()` 不再隱藏浮動視窗，push-to-talk 也不再立即隱藏，錯誤顯示約 2 秒後自動隱藏。整合測試（假伺服器 `/inference` 回 500）：放開按鍵到結束由 10011ms 降為 10ms，歷史仍為 `failed / transcription_failed` |
| 既有：`ws` 被列為 Vite external 但沒加進 Forge 的 `nativeModules` 複製清單 | 若主程序在載入時 `require('ws')`，打包後可能找不到模組 | 非本任務造成，T8 打包實測時一併確認 |
| 打包後找不到 migration 檔 | 資料庫不初始化 | `extraResource` + 啟動時記錄實際路徑；失敗進入降級模式 |
| 歷史寫入拖慢插入 | 使用者體驗退化 | 寫入一律在插入之後 |
| 音訊佔用空間 | 磁碟增長 | 預設不存；開啟時配合保存天數清理 |

## 10. 實作拆分

依全域 CLAUDE.md：Claude 負責整合、跨層修改與審查；機械性與大量程式碼交給 Codex。

| # | 任務 | 執行者 | 依賴 |
|---|---|---|---|
| T1 | 依賴、`drizzle.config.ts`、Vite external、Forge 設定 | Claude | — |
| T2 | `src/main/db/`（client、schema、migrate）與第一份 migration | Codex | T1 |
| T3 | history service（types、procedures、audio-store、facade） | Codex | T2 |
| T4 | settings service 與 zod schema，接上 ASR 設定讀取 | Codex | T2 |
| T5 | IPC handler、channels、shared types、preload | Codex | T3、T4 |
| T6 | ASR 回傳 `ASRSessionOutcome`，push-to-talk 寫入點 | Claude | T3 |
| T7 | 啟動、關閉、降級模式；填寫 `spec/backend/database-guidelines.md` | Claude | T2–T6 |
| T8 | 驗證 | Claude | 全部 |

## 11. 驗收標準

T8（2026-10-14）驗證結果。「整合測試」指在真正的 Electron 主程序中，以假的 whisper 伺服器、暫存 userData、空殼文字插入執行；「實機」指使用者真實聽寫。

- [x] `pnpm typecheck` 與 `pnpm lint` 通過
- [x] 首次啟動自動建立資料庫並套用 migration（`pnpm start` 與打包版皆從零建立）
- [x] 一次成功聽寫產生一列 `completed`，含 `raw_text`、`final_text`、`audio_duration_ms`、`latency_ms`、`insert_status = 'inserted'`（整合測試；**實機待測**）
- [x] 沒說話就放開，產生 `empty`（整合測試）
- [x] whisper 伺服器未啟動時，產生 `failed`，`error_code = 'start_failed'`（整合測試）
- [x] 錄音中強制結束 app，下次啟動該列變為 `failed / interrupted`（T7 測試）
- [x] `history.enabled = false` 時不產生任何列（整合測試）
- [x] `history.saveAudio = true` 時產生 wav 檔，刪除該列時檔案一併刪除（T3、T6 測試）
- [x] 資料庫無法開啟或 migration 失敗時，進入降級模式，log 顯示歷史停用（T7 測試：無寫入權限、migration 資料夾不存在）
- [x] **打包後的 app** 能啟動、建立資料庫、記錄歷史：實機聽寫 2 筆 `completed / inserted`（3.6 秒與 6.1 秒，中文及中英混合，2026-10-14 22:03）。前提：輔助使用崩潰已修（`38ce31f`）、啟動時請求麥克風（`7b40f1a`）、app 以正確識別碼簽章（見下方）
- [x] 文字插入的體感延遲與修改前相同：歷史寫入在插入之後；實機從放開按鍵到插入約 0.6 秒，其中 whisper 轉寫約 0.5 秒
- [x] 正常結束（Cmd+Q）時 log 出現 `Database closed`，WAL 檔已合併清除
- [x] 錄音中途結束 app，下次啟動標為 `failed / interrupted`：實機 2 筆

實機測試發現的既有問題（皆非資料層）：

| 問題 | 原因 | 處理 |
|---|---|---|
| 每次聽寫都插入「Thank you.」 | 錄到靜音：(1) `requestMicrophonePermission()` 從未被呼叫；(2) 打包版沿用 Electron 的 ad-hoc 簽章，識別碼為 `com.github.Electron`，與 bundle ID 不符，macOS 不跳出麥克風詢問，也不列入麥克風清單 | (1) 已修（`7b40f1a`）；(2) 以 `codesign --force --deep --sign -` 重新簽章後麥克風詢問出現並可授權，已證實。**尚需在 Forge 設定中修正簽章**，否則每次打包都會復發 |
| 短按右 Option 會卡住錄音直到結束 app | `KeyboardService` 對過短的放開事件直接忽略，但錄音在按下時已開始 | 另開任務 |
| 靜音或極短錄音被 Whisper 幻覺成英文句子並插入 | Whisper 引擎特性 | 後續：最短錄音長度或靜音偵測 |

T8 修正的既有打包問題：`ws` 與 `@xitanggg/node-insert-text-darwin-*` 未被複製進打包內容，打包版在載入主程序時即失敗（`1bed91e`）。

## 12. 待決定事項

以下採用了建議預設值，可隨時調整：

| 問題 | 預設 | 其他選項 |
|---|---|---|
| 是否預設保存音訊 | 否 | 是，並設保存天數 |
| 文字歷史保存多久 | 永久，手動清除 | 30／90 天自動清理 |
| 是否記錄前景應用 | 否（v1 不做） | 加一個預設關閉的設定 |
| 自訂詞彙表 | 不在本任務 | 下一個任務：可作為 whisper.cpp 的 prompt 提升專有名詞辨識，這是我的建議，**不是**從 Typeless 分析得出 |
