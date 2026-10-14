# 靜音偵測與 app 管理的 whisper 伺服器

## 目標

1. **按住但沒說話時，不送辨識、不插入文字**。目前 Whisper 收到靜音會產生「Thank you.」之類的幻覺文字，並被插入到游標處
2. **不必手動啟動 whisper 伺服器**。目前沒有先在終端機啟動伺服器，按鍵就會出現「Cannot reach whisper.cpp server」

## 已確定的決定

| 問題 | 決定 |
|---|---|
| 伺服器由誰啟動 | 由 app 管理：app 啟動時啟動，app 結束時關閉 |
| 啟動時機 | app 啟動時預先啟動，第一次按鍵不必等模型載入 |
| 靜音偵測 | 兩層：app 端音量檢查（一定啟用）＋伺服器端 Silero VAD（找到模型時啟用） |

---

## 1. 靜音偵測（app 端）

### 位置

`WhisperClient.transcribe()`，在組 WAV、送出請求之前。這樣外部伺服器也受保護，而且完全靜音時連請求都不送。

### 演算法

- 把 16 kHz、16-bit PCM 切成 20 ms 的片段（320 個樣本）
- 計算每段 RMS，換算為 dBFS（`20·log10(rms / 32768)`）
- RMS ≥ `VOICED_FRAME_DBFS` 的片段視為「有聲」
- 有聲片段累計時長 < `MIN_VOICED_MS` → 判定為靜音

### 判定為靜音時

- 不送 whisper.cpp
- 不插入文字，浮動視窗正常收起
- 歷史記為 `empty`（現有的「沒有文字」路徑）
- log 記錄 `{ durationMs, voicedMs, peakDbfs, rmsDbfs }`

**每一次**工作階段都記錄這組數據，不論是否判定為靜音，作為調整門檻的依據。

### 初始門檻（待校準）

| 常數 | 初始值 | 說明 |
|---|---|---|
| `VOICED_FRAME_DBFS` | -45 dBFS | 約等於 int16 RMS 184 |
| `MIN_VOICED_MS` | 200 ms | 至少 10 個有聲片段 |

renderer 的 `getUserMedia` 開啟了回音消除、降噪與自動增益，實際的靜音與輕聲說話音量**未知**，這兩個值是推測。實作後必須用實機錄音校準（見第 5 節）。

### 結果回報

`ASRSessionOutcome` 新增 `speech: { voicedMs, peakDbfs, rmsDbfs } | null` 與 `skipped: 'silence' | null`，供 log 與日後的歷史 `meta` 使用。`stop()` 與 IPC 合約不變。

## 2. 伺服器端 VAD

app 管理伺服器、且找到 VAD 模型時，啟動參數加上 `--vad --vad-model <path>`。

- 模型搜尋：環境變數 `WHISPER_VAD_MODEL_PATH`，否則 whisper.cpp `models/` 下的 `ggml-silero-*.bin`
- 找不到就不加，只靠 app 端音量檢查
- **不自動下載模型**。README 說明用 `models/download-vad-model.sh` 下載
- 排除 `for-tests-*` 開頭的測試模型

## 3. app 管理的 whisper 伺服器

### 新服務

`src/main/services/whisper-server/`，主程序單例 `whisperServerService`。

### 設定來源（依序）

| 項目 | 環境變數 | 自動偵測 |
|---|---|---|
| 伺服器程式 | `WHISPER_SERVER_BIN` | `~/whisper.cpp/build/bin/whisper-server`、`/opt/homebrew/bin/whisper-server`、`/usr/local/bin/whisper-server` |
| 模型 | `WHISPER_MODEL_PATH` | `~/whisper.cpp/models/` 下依序找 `large-v3-turbo`、`large-v3`、`medium`、`small`、`base` 的 `ggml-*.bin` |
| 位址與埠 | 沿用 `asr.whisperServerUrl` 設定 | — |

- 只有位址是 `localhost` 或 `127.0.0.1` 時才會自行啟動；其他主機視為外部伺服器
- 找不到程式或模型時，不啟動，記錄原因，行為與現在相同（按鍵時提示連不上）

### 啟動參數

```
whisper-server -m <model> -l auto --host 127.0.0.1 --port <port> [--vad --vad-model <vad>]
```

`-l auto` 讓沒有指定語言的請求自動偵測；指定語言時由請求帶入，與現在相同。

### 生命週期

```
app ready
  └─ whisperServerService.start()（不阻塞啟動）
       ├─ 位址上已有伺服器回應 → 使用它，不啟動（external）
       ├─ PID 檔指向的程序仍在、且確認是我們的 whisper-server → 接管（adopted）
       └─ 否則 spawn → 輪詢 GET / 直到 200（最長 60 秒）→ ready
意外結束 → 退避後重啟；60 秒內超過 3 次就停止並記錄
before-quit → 只結束自己啟動或接管的程序：SIGTERM，3 秒後仍在則 SIGKILL
```

### 所有權

- spawn 後把 PID 寫到 `userData/whisper-server.pid`
- 下次啟動時，**PID 本身不足以證明所有權**：必須用 `ps -p <pid> -o command=` 確認指令包含同一個程式路徑和 `--port <port>`，才視為我們的程序並接管。不符就刪掉 PID 檔，不碰那個程序
- 外部伺服器（不是我們啟動的）永遠不會被結束

### 與錄音流程的整合

- `asrService.start()` 連線前，若伺服器正在由 app 啟動中，先等待就緒（最長 30 秒），浮動視窗維持「connecting」
- 啟動失敗或逾時 → 與現在相同，記錄 `start_failed`
- 伺服器 stdout/stderr 寫入 app log（加上前綴、限制行長），啟動失敗時保留最後 20 行供診斷

### 狀態

`whisperServerService.status()` 回傳 `{ mode: 'managed' | 'adopted' | 'external' | 'unavailable', state: 'starting' | 'ready' | 'stopped' | 'failed', pid, binary, model, vadModel, reason }`。這次只用於 log；之後主視窗可以顯示。

## 4. 不在範圍內

- 設定介面（之後的主視窗任務）
- 自動下載模型
- 打包時內建 whisper.cpp 或模型
- 設定 macOS 背景服務

## 5. 驗證

### 自動化（Electron 整合測試，暫存 userData，文字插入換成空殼）

用一個 Node 腳本模擬 `whisper-server`：接受相同參數、延遲數秒才開始回應、可被指示當掉。

- 音量檢查：全零、低噪音、300 ms 正弦波、長句模擬，判定符合預期；靜音時沒有送出請求
- 位址上已有伺服器 → 不 spawn
- 正常 spawn → ready；按鍵在啟動中 → 等待後成功
- 程序當掉 → 自動重啟；短時間連續當掉 → 停止並記錄
- 結束 app → 自己的程序被結束；外部伺服器不受影響
- PID 檔指向不相干的程序 → 不接管、不結束它
- 找不到程式或模型 → `unavailable`，聽寫流程照舊

### 實機校準（需要你配合）

開啟 `history.saveAudio`，錄三種情況，從 log 的音量數據和 WAV 檔決定最終門檻：

1. 按住 2 秒不說話
2. 輕聲說一句
3. 正常說一句

### 實機驗收

- 不開終端機，直接開 app → 按鍵即可聽寫
- 按住不說話 → 不插入任何文字
- 結束 app 後，`whisper-server` 程序不存在

## 6. 實作拆分

| # | 任務 | 執行者 |
|---|---|---|
| S1 | 音量檢查與 `ASRSessionOutcome` 擴充 | Claude |
| S2 | whisper-server 服務（設定偵測、spawn、就緒、重啟、所有權、結束） | Codex，Claude 審查 |
| S3 | 接入 `main.ts` 與 `asrService.start()`；更新 `.env.example`、README | Claude |
| S4 | 自動化測試、實機校準與驗收 | Claude 與你 |
