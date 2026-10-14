# Typeless 本地資料模型分析（階段 A）

## 來源與方法

| 項目 | 內容 |
|---|---|
| 目標 | Typeless 2.8.2（macOS，`/Applications/Typeless.app`） |
| 讀取的檔案 | `Contents/Resources/drizzle/` 下 14 份 migration SQL、`meta/_journal.json`、`meta/0013_snapshot.json` |
| 方法 | 只讀檔，未執行 Typeless，**未讀取任何使用者資料庫內容**，只讀結構 |
| 相關證據 | REA `analyze_javascript_application` 的 `ev_257dfa90…`（本次未使用其內容，僅用於確認 `drizzle-orm`、`better-sqlite3`、`@libsql/client` 為依賴） |
| 範圍 | 只涵蓋**本地資料庫的結構與演進**。伺服器端資料模型與同步協定不在此範圍 |

標記：**[觀察]** 直接寫在 SQL 裡；**[推論]** 由觀察推導；**[未知]** 無法從 migration 確認。

---

## 1. 演進時間軸 [觀察]

日期來自 `_journal.json` 的時間戳（UTC）。

| # | 日期 | 變更 |
|---|---|---|
| 0000 | 2025-06-24 | 建立 `history` 表（17 欄），含音訊 blob、潤稿文字、編輯後文字與其擷取狀態、麥克風、語言、無障礙文字（`ax_text`、`ax_html`） |
| 0001 | 2025-07-01 | 加 `debug_info` |
| 0002 | 2025-07-03 | 加 `audio_local_path`、`audio_cloud_path`、`user_id` |
| 0003 | 2025-07-03 | **刪除** `audio_cloud_path`（加入後同日移除） |
| 0004 | 2025-07-09 | 加 `focused_app` |
| 0005 | 2025-07-16 | 加 `audio_metadata` |
| 0006 | 2025-07-23 | 把 focused app 拆成 6 欄（名稱、bundle id、視窗標題、網頁標題、網域、網址），並建立 8 個索引 |
| 0007 | 2025-07-23 | 加 `mic_device_info`（blob） |
| 0008 | 2025-08-28 | 加 `mode`，預設 `voice_transcript` |
| 0009 | 2025-11-11 | 加 `mode_meta` |
| 0010 | 2025-12-04 | 加 `client_metadata`（blob） |
| 0011 | 2026-04-16 | **新建 `history_v2`**（17 欄，精簡版），舊 `history` 表仍保留 |
| 0012 | 2026-06-29 | `history_v2` 加同步欄位：`server_updated_at`、`sync_status`、`sync_attempt_count`、`synced_from_cloud`，並建立「待推送」部分索引 |
| 0013 | 2026-09-21 | 重建待推送索引，納入 `mode = 'voice_command'` 且結果為外部遞送的項目 |

## 2. 最終結構（0013 snapshot）[觀察]

### `history_v2`（現行，21 欄）

| 群組 | 欄位 |
|---|---|
| 識別 | `id`（text, PK, unique）、`user_id` |
| 狀態與模式 | `status`、`mode`（預設 `voice_transcript`）、`mode_meta`（blob） |
| 內容 | `refined_text`、`duration`（real） |
| 時間 | `created_at`、`updated_at`（皆為 text） |
| 音訊 | `audio_local_path`、`audio_metadata`、`audio_context` |
| 裝置與環境 | `app_version`（預設 `0.0.0`）、`mic_device`、`mic_device_info`（blob）、`client_metadata`（blob） |
| 除錯 | `debug_info` |
| 同步 | `server_updated_at`（integer）、`sync_status`（預設 `pending_upload`）、`sync_attempt_count`（預設 0）、`synced_from_cloud`（預設 false） |

索引：`(user_id, created_at)`、`(status)`、`(user_id, status, created_at)`、`id` 唯一索引，以及一個**部分索引**（待推送候選）。

### `history`（舊表，33 欄，仍存在）

v2 沒有的欄位：`audio`（blob）、`edited_text`、`edited_text_status`、`edited_text_attempts`、`languages`、`detected_language`、`hasRevertedAI`、`ax_text`、`ax_html`、`focused_app*` 共 7 欄。另有 9 個索引，其中 6 個針對「使用者 × 應用 × 網域 × 狀態 × 時間」的組合查詢。

## 3. 設計觀察

### 3.1 v2 重寫瘦身 [觀察] + 原因 [推論]

- v2 **移除**了：音訊 blob、編輯後文字及其擷取狀態、語言偵測、無障礙文字與 HTML、整組 focused app 欄位
- v2 **保留並升級**：`mode_meta` 與 `client_metadata` 為 blob
- [推論] 可能的原因：把容易變動的資訊收進 metadata blob，主表只保留穩定欄位；音訊不再進資料庫。這是由欄位變化反推，**migration 不會說明動機**
- [未知] 舊 `history` 的資料是否搬進 `history_v2`、focused app 資訊是否移到 `client_metadata`，要看程式碼，migration 沒有資料搬移語句

### 3.2 音訊儲存的轉變 [觀察]

先是 `audio` blob 直接存資料庫（0000），之後加入 `audio_local_path`（0002），v2 完全不含 blob。雲端音訊路徑只存在兩天就移除（0002 → 0003）。[推論] 音訊走檔案系統，且不同步到雲端；只是依欄位刪除推論，未證實。

### 3.3 同步機制 [觀察] + 推論

- `sync_status` 預設 `pending_upload`，另有重試次數與 `server_updated_at`、`synced_from_cloud`
- 待推送索引只收：`status = 'completed'` 且有非空 `refined_text` 的項目；0013 起，另收 `mode = 'voice_command'` 且 `mode_meta.ai_result.delivery = 'external'` 的項目
- [推論] 這是「本地優先、背景推送」模型：本地先寫入，標記待上傳，由背景程序重試。`server_updated_at` 與 `synced_from_cloud` 暗示雙向同步，但**衝突解決策略未知**
- 與 IPC 證據吻合：REA 解出的 `sync-engine:transcription-history:get-sync-status`、`wipe-cloud-history`

### 3.4 兩種模式 [觀察]

- `voice_transcript`（預設）：一般語音轉文字
- `voice_command`：語音指令，結果有 `delivery` 欄位，值包含 `external`
- migration 檔名含 `ask_anything_external_push_candidate`，[推論] 對應一個「對 AI 提問」的功能，答案可能不是插入游標處而是外部遞送。具體行為未知

### 3.5 情境資料的敏感度 [觀察]

舊表記錄了前景應用名稱、bundle id、視窗標題、網頁標題、網域、完整網址，另有無障礙文字與 HTML。這類資料隱私敏感。v2 主表不再有這些欄位，是否仍收集、存在哪，[未知]。

### 3.6 「學習使用者修改」的痕跡 [推論]

`edited_text`、`edited_text_status`（預設 `NOT_EXTRACTED`）、`edited_text_attempts`、`hasRevertedAI`、`ax_text`、`ax_html` 合起來，像是在插入文字後，透過無障礙 API 讀回使用者的修改，以評估或學習。這是欄位組合的推論，**沒有任何程式碼證據**。v2 已移除這組欄位，不代表功能已拿掉。

## 4. 對 open-typeless 的啟示（設計建議，非 Typeless 的事實）

| 啟示 | 依據 |
|---|---|
| 音訊從第一天就存成檔案，資料庫只存路徑 | Typeless 先放 blob，後來全面改為路徑（並因此重寫資料表） |
| 穩定欄位進主表，易變資訊放 JSON metadata | Typeless 後來把多項資訊收進 `*_meta` blob |
| 一開始就用 migration 工具（drizzle 或同類） | 14 次演進、1 次重寫，證明結構一定會變 |
| 主表一開始就留 `mode` 欄位 | 之後出現 `voice_command` 等新模式時不必動結構 |
| 情境資料（前景應用、網址）預設不收，需要時再做成明確的選項 | 敏感度高，且 Typeless 自己也從主表移除 |
| 先不做雲端同步欄位 | 你的方向是本地優先，同步可以之後再加 |

### 建議的最小起點（自行設計，不是複製）

```text
history
  id            text primary key        -- uuid
  created_at    text not null           -- ISO 8601
  status        text not null           -- recording | processing | completed | failed
  mode          text not null default 'voice_transcript'
  text          text                    -- 最終插入的文字
  raw_text      text                    -- 辨識原文（便於比較後處理效果）
  duration_ms   integer
  audio_path    text                    -- 可為空，音訊存檔案系統
  engine        text                    -- 例如 whisper.cpp 與模型名稱
  language      text
  mic_device    text
  app_version   text not null
  meta          text                    -- JSON，放易變資訊
index: (created_at), (status, created_at)
```

這份結構是依上面的觀察與 open-typeless 的 whisper.cpp 後端所設計，欄位是否合適要看你實際想做的功能（歷史瀏覽、統計、重新插入）。

## 5. 仍未知

- 舊資料如何遷移到 `history_v2`
- 其他資料表是否存在於**不同的資料庫檔**（例如字典、設定走 `electron-store`，不在這裡）
- `mode_meta`、`client_metadata`、`audio_metadata` 的內部欄位
- `status` 的完整取值（只確認有 `completed`）
- 同步衝突解決策略與雲端資料模型
- 是否有使用者字典、片語、風格設定等表（這批 migration 裡**沒有**，可能在別處）

## 6. 下一步建議

1. 用 REA 的語意追蹤，找出 `history_v2` 的寫入點，以補上 `status` 取值與 `mode_meta` 內容
2. 回到 open-typeless，依第 4 節建立 `history` 資料層（交給 Codex 實作，Claude 審查）
3. 在決定是否做雲端同步前，先確認你的產品方向
