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

- Apple Silicon Mac（M1 或更新），macOS 13.3 以上
- 一個 ggml 辨識模型（需另外下載）
- 從原始碼開發時另需 Node.js 22、pnpm 10、Xcode Command Line Tools 與 CMake

## 快速開始

### 使用打包版

打包版已內建 whisper-server，**不需要安裝或編譯 whisper.cpp**。開啟 app，在「設定 → 語音辨識」按「打開模型資料夾」，放入下載好的 ggml `.bin` 模型，再從「辨識模型」選單選取它。模型來源可參考下方的 whisper.cpp 模型或粵語模型說明；伺服器程式旁會顯示「內建」。

### 1. 準備模型（從原始碼開發）

以下用 whisper.cpp 的下載腳本取得模型；不需要編譯它的伺服器：

```bash
git clone https://github.com/ggml-org/whisper.cpp ~/whisper.cpp
cd ~/whisper.cpp
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
| 伺服器程式 | 優先使用內建程式，再找 `~/whisper.cpp/build/bin/whisper-server`、`/opt/homebrew/bin/whisper-server`、`/usr/local/bin/whisper-server` | `WHISPER_SERVER_BIN`（最高優先權） |
| 模型 | `~/whisper.cpp/models/` 中依序找 large-v3-turbo、large-v3、medium、small、base | `WHISPER_MODEL_PATH` |
| VAD 模型（選用） | `~/whisper.cpp/models/ggml-silero-*.bin`，找到時自動加上 `--vad` | `WHISPER_VAD_MODEL_PATH` |

- 啟動參數包含 `-l auto`（自動偵測語言）與 `--host 127.0.0.1`（只接受本機連線）
- large-v3-turbo 載入約需 7 秒；載入期間按鍵，app 會等待伺服器就緒後再辨識
- 伺服器意外結束時會自動重啟；60 秒內連續當掉超過 3 次則停止，原因記在記錄檔
- **位址上已有伺服器在執行時，app 會直接使用它，結束時也不會關閉它**

自己編譯的 whisper.cpp 仍可作為後備程式，或以 `WHISPER_SERVER_BIN` 指定。也可以自己啟動已編譯的伺服器，例如使用其他模型：

```bash
cd ~/whisper.cpp
./build/bin/whisper-server -m models/ggml-large-v3-turbo.bin -l auto --host 127.0.0.1 --port 8080
```

不加 `-l auto` 時，伺服器預設以英文辨識，中文會辨識錯誤。

### 辨識模型選擇

在「設定 → 語音辨識 → 辨識模型」選擇模型；預設「自動」維持原有的優先順序（large-v3-turbo → large-v3 → medium → small → base）。清單會掃描 app 的 `<userData>/models`（macOS 通常為 `~/Library/Application Support/open-typeless/models`）和 `~/whisper.cpp/models`，只列出具有 ggml 標頭的 `.bin` 模型，不含測試或 Silero VAD 模型。按「打開模型資料夾」會建立並開啟 app 的模型資料夾，把下載好的模型放進去即可，清單會自動更新。

切換模型時，由 app 管理或沿用的伺服器會重新啟動，狀態顯示「正在載入模型…」。找不到選擇的模型時會暫時回到自動選擇並顯示提示。`WHISPER_MODEL_PATH` 的優先權最高；若設了此環境變數，或連線的是外部伺服器，選單會停用並說明原因。

粵語使用者建議選用 **large-v3-cantonese q8_0**，辨識語言設「自動偵測」，潤稿風格設「一般」。模型來自 [kiuckhuang/whisper-large-v3-cantonese-ggml](https://huggingface.co/kiuckhuang/whisper-large-v3-cantonese-ggml)，採 Apache-2.0 授權，由 `khleeloo/whisper-large-v3-cantonese` 轉換；可直接輸出粵語口語，自動偵測也能兼顧普通話與英文。2026-10-15 的 12 句 macOS Sinji 合成粵語測試中，相較 Turbo，字元錯誤率由 37.9% 降至 3.4%，口語標記保留率由 2% 升至 98%；自動偵測每句約 0.66 秒（指定 `yue` 約 0.40 秒，Turbo 約 0.25 秒）。一段 68 秒真人錄音約需 3.0–3.3 秒，Turbo 約 1.5 秒；這些是本機小樣本結果，實際速度與準確度會依錄音和硬體而異。

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

## AI 潤稿（選用）

AI 潤稿預設關閉，可在「設定 → AI 潤稿」啟用。需要先在本機啟動 oMLX，app 會讀取 `~/.omlx/settings.json` 的連接埠與 API 金鑰，僅將文字送至 `127.0.0.1`，文字不會離開這台電腦。

建議模型：`Qwen3.5-9B-4bit`（快速，預設）或 `Qwen3.8-27B-oQ4e-mtp`（高品質）。潤稿會刪除贅字、補上標點、修正口誤並轉成繁體中文（模型輸出若仍有簡體字，會再用 OpenCC 轉成繁體，本來就是繁體或粵語的文字不會被改動）；連線失敗、逾時或輸出不合理時，直接使用原始辨識文字。歷史紀錄會保留原文及潤稿結果。

「潤稿風格」預設為「自動」：辨識語言設為粵語（`yue`）時使用「粵語口語」，其他語言使用「一般」。whisper 常把粵語辨識成書面中文，因此粵語口語風格會把辨識結果還原成「我哋、佢、唔、咗」等日常用字；也可手動選擇風格。每句約多等 2–3 秒，建議使用 `Qwen3.8-27B`，9B 較常改錯；辨識時已遺失或聽錯的詞語仍無法還原。

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
| `asr.model` | `null`（自動） | 辨識模型 id，例如 `app/ggml-large-v3-cantonese-q8_0.bin` 或 `whisper.cpp/ggml-base.bin` |
| `asr.language` | `.env` 或自動偵測 | 語言提示 |
| `asr.vocabulary` | 空 | 自訂詞彙表（最多 50 個，每個最長 40 字），見下方「專有名詞辨識不準」 |
| `polish.enabled` | `false` | 是否啟用本機 AI 潤稿 |
| `polish.model` | `Qwen3.5-9B-4bit` | oMLX 潤稿模型 |
| `polish.style` | `auto` | 潤稿風格：`auto`、`standard`、`cantonese` |
| `input.autoInsert` | `true` | 是否自動插入文字 |

可在主視窗查看歷史與調整設定；變更會儲存在本機資料庫。

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
pnpm verify:package # 檢查打包結果（migration、原生模組、內建伺服器、簽章）
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

### 內建 whisper-server 的建置

`pnpm start` 和 `pnpm package` 在 darwin arm64 上會先執行 `scripts/build-whisper-server.sh`；其他平台會顯示略過訊息。腳本固定使用 whisper.cpp **v1.9.5**，並檢查 tag 對應 commit `d1be6fde11ac6e0407606b4e42fe72d34add8037`。它以 `BUILD_SHARED_LIBS=OFF`、`GGML_NATIVE=OFF`、`GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`、`GGML_METAL_EMBED_LIBRARY=ON` 與 Accelerate BLAS 建置，適用 M1 及後續 Apple Silicon，Metal 程式庫嵌入單一執行檔，僅連結系統函式庫。Accelerate 的 `cblas_sgemm` 需要 macOS 13.3，因此 app 與伺服器最低版本均為 13.3。

首次建置需要 CMake（例如 `brew install cmake`）與 Xcode Command Line Tools。原始碼和建置快取位於 `node_modules/.cache/whisper.cpp`，產物為 `resources/bin/whisper-server` 與 `whisper-server.version`；版本戳記符合時會跳過重建。CI 依建置腳本的雜湊快取這兩個目錄，並在打包前明確執行腳本。打包時兩個產物會放進 `Contents/Resources/`；開發模式則從專案的 `resources/bin/` 尋找。

`pnpm verify:package` 會檢查內建程式的執行權限、arm64 架構、系統連結、最低 macOS 版本、獨立簽章與 app 簽署身分是否相符，並在 10 秒內執行 `--help`，最後顯示版本戳記。

### 打包與簽章

打包後會先用相同身分簽章 `Contents/Resources/whisper-server`，再重新簽章 `.app`，讓簽章識別碼與 bundle ID（`com.electron.open-typeless`）一致，否則 macOS 不會跳出麥克風授權。簽章身分依序選用：

1. 環境變數 `CODESIGN_IDENTITY`
2. 鑰匙圈中名為 `Open Typeless Dev` 的程式碼簽署憑證
3. 都沒有時改用 ad-hoc 簽章（例如 CI）

ad-hoc 簽章在每次重新打包後都會改變，macOS 會再次詢問麥克風與輔助使用權限。本機開發建議建立固定的自簽憑證：

1. 打開「鑰匙圈存取」，選單選「憑證輔助程式 → 製作憑證⋯」。
2. 名稱填 `Open Typeless Dev`，身分類型選「自簽根憑證」，憑證類型選「程式碼簽署」，按「製作」。
3. 第一次打包時，在鑰匙圈提示中輸入登入密碼並按「永遠允許」。
4. 新簽章的 app 需要重新授權一次：在「系統設定 → 隱私權與安全性 → 輔助使用」移除舊的 open-typeless 後重新加入，並在啟動時允許麥克風。之後重新打包，權限都會保留。

`pnpm verify:package` 會顯示這次的簽章方式。正式發佈前，需要在 `forge.config.ts` 的 `packagerConfig.osxSign` 設定 Apple Developer ID 憑證。

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

- `no ggml model found`：下載模型，放入 app 的模型資料夾並在設定中選取，或用 `WHISPER_MODEL_PATH` 指定路徑
- `whisper-server binary not found`：打包版應包含內建程式；開發模式可執行 `bash scripts/build-whisper-server.sh`，或用 `WHISPER_SERVER_BIN` 指定自己的程式
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
