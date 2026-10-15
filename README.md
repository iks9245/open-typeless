# Open Typeless

> **This project is a showcase for the [Trellis](https://github.com/mindfold-ai/Trellis) framework.**
>
> **本專案是 [Trellis](https://github.com/mindfold-ai/Trellis) 框架的示範專案。**

---

macOS 語音輸入工具：按住快捷鍵說話，放開後自動把文字插入到游標位置。語音辨識在本機透過 [whisper.cpp](https://github.com/ggml-org/whisper.cpp) 完成，音訊不會上傳到雲端。

## 功能特色

- 🎤 **Push-to-Talk** - 按住右 Option 鍵說話，放開自動輸入
- 🖥️ **本機辨識** - 使用本機執行的 whisper.cpp 伺服器，支援自動偵測語言（含中英混合）；app 會自動啟動與關閉伺服器
- 🔇 **靜音偵測** - 按住但沒說話時不送出辨識，避免 Whisper 產生「Thank you.」之類的幻覺文字
- 🪟 **浮動視窗** - 顯示錄音狀態與辨識結果，不搶焦點
- 🎯 **游標插入** - 自動將文字插入到目前游標位置，不需切換視窗
- 🗂️ **轉寫歷史** - 每次聽寫的結果、時長、延遲與插入結果都存在本機 SQLite
- ⚙️ **可調整的設定** - whisper 伺服器位址、語言、是否自動插入、歷史保存方式

## 系統需求

- macOS 12.0 以上（已在 Apple Silicon 上驗證）
- Node.js 22（Vite 需要 18 或 20 以上）
- pnpm 10
- 已編譯的 whisper.cpp 與一個 ggml 模型

## 快速開始

### 1. 準備 whisper.cpp

```bash
git clone https://github.com/ggml-org/whisper.cpp ~/whisper.cpp
cd ~/whisper.cpp
cmake -B build && cmake --build build -j --config Release
./models/download-ggml-model.sh large-v3-turbo
```

`large-v3-turbo` 辨識中文效果較好；電腦較慢時可改用 `base` 或 `small`。

選用：下載 Silero VAD 模型，讓伺服器更準確地分辨人聲與背景噪音：

```bash
./models/download-vad-model.sh silero-v6.2.0
```

### 2. whisper.cpp 伺服器（由 app 自動管理）

**不需要手動啟動。** 位址設為本機（預設 `http://localhost:8080`）時，app 啟動會在背景啟動 whisper-server，結束時關閉。

| 項目 | 自動偵測位置 | 覆寫用環境變數 |
|---|---|---|
| 伺服器程式 | `~/whisper.cpp/build/bin/whisper-server`、`/opt/homebrew/bin/`、`/usr/local/bin/` | `WHISPER_SERVER_BIN` |
| 模型 | `~/whisper.cpp/models/` 中依序找 large-v3-turbo、large-v3、medium、small、base | `WHISPER_MODEL_PATH` |
| VAD 模型（選用） | `~/whisper.cpp/models/ggml-silero-*.bin`，找到時自動加上 `--vad` | `WHISPER_VAD_MODEL_PATH` |

- 啟動參數包含 `-l auto`（自動偵測語言）與 `--host 127.0.0.1`（只接受本機連線）
- large-v3-turbo 載入約需 7 秒；載入期間按鍵，app 會等待伺服器就緒後再辨識
- 伺服器意外結束時會自動重啟；60 秒內連續當掉超過 3 次則停止，原因記在記錄檔
- **位址上已有伺服器在執行時，app 會直接使用它，結束時也不會關閉它**

也可以自己啟動伺服器，例如使用其他模型：

```bash
cd ~/whisper.cpp
./build/bin/whisper-server -m models/ggml-large-v3-turbo.bin -l auto --host 127.0.0.1 --port 8080
```

不加 `-l auto` 時，伺服器預設以英文辨識，中文會辨識錯誤。

### 3. 安裝依賴套件

```bash
pnpm install
```

### 4. 設定環境變數（選用）

開發模式會讀取專案根目錄的 `.env`：

```bash
cp .env.example .env
```

```env
# whisper.cpp 伺服器位址（預設 http://localhost:8080）
WHISPER_SERVER_URL=http://localhost:8080

# 語言提示（選用，不設定則自動偵測），例如 zh、en、ja
# WHISPER_LANGUAGE=zh
```

打包後的 app 不會讀取 `.env`，會使用預設值或已儲存的設定（見下方「轉寫歷史與設定」）。

### 5. 啟動 app

```bash
pnpm start
```

### 6. 授予系統權限

| 權限 | 用途 | 說明 |
|---|---|---|
| 麥克風 | 錄音 | 啟動時會跳出請求，請選擇允許 |
| 輔助使用 | 全域快捷鍵、插入文字 | 未授權時 app 會跳出說明，可一鍵開啟系統設定；授權後不需重新啟動即可使用 |
| 輸入監控 | 全域快捷鍵 | 在「系統設定」-「隱私權與安全性」-「輸入監控」中加入 |

> 使用 `pnpm start` 時，權限會歸屬於啟動它的程式（例如「終端機」）。

## 使用方式

1. 啟動本 app（whisper.cpp 伺服器會自動啟動）
2. 在任何 app 中，**按住右 Option 鍵**開始錄音
3. 浮動視窗會顯示錄音狀態
4. **放開按鍵**後，辨識完成的文字會插入到游標位置，浮動視窗 2 秒後自動隱藏
5. 按住不到 200 毫秒會被視為誤觸，直接取消，不辨識也不插入
6. 錄音中幾乎沒有聲音時（音量高於 -50 dBFS 的片段累計不到 100 毫秒），不送出辨識也不插入，歷史記為 `empty`。門檻尚未用實際錄音校準，刻意設得寬鬆：寧可把噪音送去辨識，也不漏掉輕聲說話

## 轉寫歷史與設定

資料都存在本機：

| 內容 | 位置 |
|---|---|
| 資料庫 | `~/Library/Application Support/open-typeless/open-typeless.db` |
| 錄音（預設不保存） | `~/Library/Application Support/open-typeless/audio/` |
| 記錄檔 | `~/Library/Logs/open-typeless/main.log` |

每次聽寫會記錄成一筆 `transcriptions` 資料，狀態為 `completed`、`empty`（沒有辨識到文字）或 `failed`（附帶原因，例如 `start_failed`、`transcription_failed`）。若錄音途中 app 被強制結束，下次啟動時會自動標記為 `failed / interrupted`。

可用設定與預設值：

| 設定 | 預設 | 說明 |
|---|---|---|
| `history.enabled` | `true` | 是否記錄歷史 |
| `history.saveAudio` | `false` | 是否保存錄音 |
| `history.retentionDays` | 不限 | 保留天數，每次啟動時清理 |
| `asr.whisperServerUrl` | `.env` 或 `http://localhost:8080` | whisper.cpp 伺服器位址 |
| `asr.language` | `.env` 或自動偵測 | 語言提示 |
| `asr.vocabulary` | 空 | 自訂詞彙表（最多 50 個，每個最長 40 字），見下方「專有名詞辨識不準」 |
| `input.autoInsert` | `true` | 是否自動插入文字 |

目前還沒有設定介面；歷史與設定已透過 `window.api.history` 和 `window.api.settings` 提供給渲染程序，介面會在之後加入。

資料庫無法開啟時，app 仍可正常聽寫，只是不記錄歷史。

## 專案結構

```
src/
├── main.ts                 # Electron 主程序入口（啟動時初始化資料庫）
├── preload.ts              # 預載腳本（IPC 橋接）
├── renderer.ts             # 渲染程序入口（錄音）
├── main/
│   ├── db/                 # SQLite 連線、schema、migration
│   ├── ipc/                # IPC 處理器
│   ├── services/
│   │   ├── asr/            # whisper.cpp 用戶端與 ASR 工作階段
│   │   ├── history/        # 轉寫歷史
│   │   ├── settings/       # app 設定
│   │   ├── keyboard/       # 全域鍵盤監聽
│   │   ├── whisper-server/ # 自動啟動與管理本機 whisper-server
│   │   ├── permissions/    # macOS 權限
│   │   ├── push-to-talk/   # Push-to-Talk 協調服務
│   │   └── text-input/     # 文字插入
│   └── windows/            # 視窗管理
├── renderer/
│   └── src/modules/asr/    # 錄音與浮動視窗元件
└── shared/                 # 共用型別與常數
drizzle/                    # 資料庫 migration（隨 app 打包）
```

## 開發

```bash
pnpm start          # 啟動開發模式
pnpm typecheck      # 型別檢查
pnpm lint           # 程式碼檢查
pnpm db:generate    # 修改 src/main/db/schema.ts 後產生 migration
pnpm test           # 單元測試（純 Node）
pnpm test:integration  # 整合測試（在真正的 Electron 主程序中執行）
pnpm package        # 打包
pnpm verify:package # 檢查打包結果（migration、原生模組、簽章）
pnpm make           # 建置安裝檔
```

資料庫慣例請見 `.trellis/spec/backend/database-guidelines.md`。

### 測試

| 類型 | 位置 | 說明 |
|---|---|---|
| 單元測試 | `tests/unit/` | Vitest；資料庫用記憶體 SQLite，檔案用暫存目錄。whisper-server 生命週期測試會啟動 `tests/fixtures/fake-whisper-server.mjs`，需要本機埠號與 `ps` |
| 整合測試 | `tests/integration/` | 由 `scripts/run-integration-tests.mjs` 用 esbuild 打包後交給 Electron 執行；`userData` 指向暫存目錄、文字插入被替換，不會碰到真實資料，也不會打字到其他 app |
| 打包檢查 | `scripts/verify-package.mjs` | 檢查只有打包後才會出現的問題 |

每個 PR 與推送到 `main` 時，GitHub Actions 會在 macOS 上依序執行：型別檢查、lint、單元測試、整合測試、打包、打包檢查（`.github/workflows/ci.yml`）。

### 打包與簽章

沒有設定簽章憑證時，打包流程會對 `.app` 進行 ad-hoc 簽章，讓簽章識別碼與 bundle ID（`com.electron.open-typeless`）一致，否則 macOS 不會跳出麥克風授權。

ad-hoc 簽章在每次重新打包後都會改變，macOS 可能會再次詢問鑰匙圈、麥克風與輔助使用權限。正式發佈前，需要在 `forge.config.ts` 的 `packagerConfig.osxSign` 設定固定的簽章憑證。

## 技術架構

- **Electron** - 桌面應用程式框架
- **React** - UI 框架
- **TypeScript** - 型別安全
- **Vite** - 建置工具
- **whisper.cpp** - 本機語音辨識
- **better-sqlite3 + Drizzle** - 本機資料庫
- **uiohook-napi** - 全域鍵盤監聽
- **node-insert-text** - 文字插入

## 常見問題

### Q：出現「Cannot reach whisper.cpp server」？

app 沒能啟動或連上 whisper.cpp 伺服器。請查看記錄檔 `~/Library/Logs/open-typeless/main.log` 中 `whisper-server` 開頭的訊息：

- `whisper-server binary not found` 或 `no ggml model found`：依照「準備 whisper.cpp」編譯並下載模型，或用環境變數指定路徑
- `exited before becoming ready` 或 `exceeded 3 unexpected exits`：伺服器啟動失敗，記錄檔會附上它最後的輸出
- 位址不是本機時，app 不會自動啟動伺服器，請確認該伺服器正在執行

也可以自己啟動伺服器（見上方指令），不需要重新啟動 app。

### Q：每次都插入「Thank you.」之類的文字？

這是 whisper 收到靜音時產生的幻覺文字。app 會先檢查音量，幾乎沒有聲音時不送出辨識；若仍經常出現，通常代表麥克風沒有錄到聲音：

1. 確認 app 已取得麥克風權限（「系統設定」-「隱私權與安全性」-「麥克風」）
2. 若打包版沒有出現在麥克風清單中，請重新執行 `pnpm package`，並確認簽章識別碼為 `com.electron.open-typeless`：`codesign -dv out/open-typeless-darwin-arm64/open-typeless.app`

### Q：中文被辨識成英文？

啟動 whisper.cpp 伺服器時需要加上 `-l auto`，或在 `.env` 中設定 `WHISPER_LANGUAGE=zh`。

### Q：快捷鍵沒有反應？

確認已授予「輔助使用」與「輸入監控」權限。未授予輔助使用權限時，app 會跳出說明；授權後會自動啟用，不需重新啟動。

### Q：文字無法插入？

1. 確認游標在文字輸入區域
2. 檢查「輔助使用」權限
3. 確認設定 `input.autoInsert` 沒有被關閉

### Q：專有名詞辨識不準？

whisper 對產品名稱等專有名詞容易誤認，例如把 Typeless 辨識成 timeless。在設定 `asr.vocabulary` 加入常用詞彙後，每次辨識都會以一句提示送給 whisper，例如：

```
這段話可能會提到 Open Typeless、Trellis 和 whisper.cpp。
```

- 詞彙會去除重複，總長度超過約 150 字時，排在後面的詞彙不會送出
- 有詞彙表時，辨識結果傾向使用**繁體中文**（whisper 會模仿提示句的寫法）
- 以合成語音測試時，「Open Typeless」可被正確辨識；中文語音唸的英文縮寫（例如 REA）改善有限

目前還沒有設定介面，詞彙表會在之後的主視窗中提供編輯。

### Q：如何更換快捷鍵？

目前快捷鍵固定為右 Option 鍵。如需自訂，可修改 `src/main/services/keyboard/keyboard.service.ts` 中的 `triggerKey` 設定。

## 授權條款

MIT
