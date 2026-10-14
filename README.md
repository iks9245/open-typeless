# Open Typeless

> **This project is a showcase for the [Trellis](https://github.com/mindfold-ai/Trellis) framework.**
>
> **本项目是 [Trellis](https://github.com/mindfold-ai/Trellis) 框架的示例项目。**

---

macOS 语音输入工具：按住快捷键说话，松开后自动把文字插入到光标位置。语音识别在本机通过 [whisper.cpp](https://github.com/ggml-org/whisper.cpp) 完成，音频不会上传到云端。

## 功能特性

- 🎤 **Push-to-Talk** - 按住右 Option 键说话，松开自动输入
- 🖥️ **本地识别** - 使用本机运行的 whisper.cpp 服务器，支持自动检测语言（含中英混合）
- 🪟 **悬浮窗显示** - 显示录音状态和识别结果，不抢焦点
- 🎯 **光标插入** - 自动将文字插入到当前光标位置，无需切换窗口
- 🗂️ **转写历史** - 每次听写的结果、时长、延迟和插入结果保存在本地 SQLite
- ⚙️ **可修改的设置** - whisper 服务器地址、语言、是否自动插入、历史保存策略

## 系统要求

- macOS 12.0+（已在 Apple Silicon 上验证）
- Node.js 22（Vite 要求 18 或 20 以上）
- pnpm 10
- 已编译的 whisper.cpp 及一个 ggml 模型

## 快速开始

### 1. 准备 whisper.cpp

```bash
git clone https://github.com/ggml-org/whisper.cpp ~/whisper.cpp
cd ~/whisper.cpp
cmake -B build && cmake --build build -j --config Release
./models/download-ggml-model.sh large-v3-turbo
```

`large-v3-turbo` 识别中文效果较好；机器较慢时可改用 `base` 或 `small`。

### 2. 启动 whisper.cpp 服务器

使用期间请保持这个终端窗口开启：

```bash
cd ~/whisper.cpp
./build/bin/whisper-server -m models/ggml-large-v3-turbo.bin -l auto --host 127.0.0.1 --port 8080
```

- `-l auto`：自动检测语言。**不加时服务器默认按英文识别**，中文会识别错误
- `--host 127.0.0.1`：只接受本机连接

### 3. 安装依赖

```bash
pnpm install
```

### 4. 配置环境变量（可选）

开发模式会读取项目根目录的 `.env`：

```bash
cp .env.example .env
```

```env
# whisper.cpp 服务器地址（默认 http://localhost:8080）
WHISPER_SERVER_URL=http://localhost:8080

# 语言提示（可选，不设置则自动检测），例如 zh、en、ja
# WHISPER_LANGUAGE=zh
```

打包后的应用不读取 `.env`，使用默认值或已保存的设置（见下文「设置」）。

### 5. 启动应用

```bash
pnpm start
```

### 6. 授权系统权限

| 权限 | 用途 | 说明 |
|---|---|---|
| 麦克风 | 录音 | 启动时会弹出请求，请选择允许 |
| 辅助功能 | 全局快捷键、插入文字 | 未授权时应用会弹出说明，可一键打开系统设置；授权后无需重启即可使用 |
| 输入监控 | 全局快捷键 | 在「系统设置」-「隐私与安全性」-「输入监控」中加入 |

> 使用 `pnpm start` 时，权限会归属于启动它的程序（例如「终端」）。

## 使用方法

1. 启动 whisper.cpp 服务器和本应用
2. 在任意应用中，**按住右 Option 键**开始录音
3. 悬浮窗显示录音状态
4. **松开按键**后，文字识别完成并插入到光标位置，悬浮窗 2 秒后自动隐藏
5. 按住少于 200 毫秒视为误触，会直接取消，不识别也不插入

## 转写历史与设置

数据保存在本机：

| 内容 | 位置 |
|---|---|
| 数据库 | `~/Library/Application Support/open-typeless/open-typeless.db` |
| 音频（默认不保存） | `~/Library/Application Support/open-typeless/audio/` |
| 日志 | `~/Library/Logs/open-typeless/main.log` |

每次听写记录为一条 `transcriptions` 数据，状态为 `completed`、`empty`（没有识别到文字）或 `failed`（附带原因，例如 `start_failed`、`transcription_failed`）。应用在录音中途被强制结束时，下次启动会自动标记为 `failed / interrupted`。

可用设置及默认值：

| 设置 | 默认 | 说明 |
|---|---|---|
| `history.enabled` | `true` | 是否记录历史 |
| `history.saveAudio` | `false` | 是否保存录音 |
| `history.retentionDays` | 不限 | 保留天数，每次启动时清理 |
| `asr.whisperServerUrl` | `.env` 或 `http://localhost:8080` | whisper.cpp 服务器地址 |
| `asr.language` | `.env` 或自动检测 | 语言提示 |
| `input.autoInsert` | `true` | 是否自动插入文字 |

目前还没有设置界面；历史和设置已通过 `window.api.history` 与 `window.api.settings` 提供给渲染进程，界面将在后续加入。

数据库无法打开时，应用仍可正常听写，只是不记录历史。

## 项目结构

```
src/
├── main.ts                 # Electron 主进程入口（启动时初始化数据库）
├── preload.ts              # 预加载脚本 (IPC 桥接)
├── renderer.ts             # 渲染进程入口（录音）
├── main/
│   ├── db/                 # SQLite 连接、schema、migration
│   ├── ipc/                # IPC 处理器
│   ├── services/
│   │   ├── asr/            # whisper.cpp 客户端与 ASR 会话
│   │   ├── history/        # 转写历史
│   │   ├── settings/       # 应用设置
│   │   ├── keyboard/       # 全局键盘监听
│   │   ├── permissions/    # macOS 权限
│   │   ├── push-to-talk/   # Push-to-Talk 协调服务
│   │   └── text-input/     # 文字插入
│   └── windows/            # 窗口管理
├── renderer/
│   └── src/modules/asr/    # 录音与悬浮窗组件
└── shared/                 # 共享类型和常量
drizzle/                    # 数据库 migration（随应用打包）
```

## 开发

```bash
pnpm start          # 启动开发模式
pnpm typecheck      # 类型检查
pnpm lint           # 代码检查
pnpm db:generate    # 修改 src/main/db/schema.ts 后生成 migration
pnpm package        # 打包
pnpm make           # 构建安装包
```

数据库约定见 `.trellis/spec/backend/database-guidelines.md`。

### 打包与签名

没有配置签名证书时，打包流程会对 `.app` 做 ad-hoc 签名，使签名标识与 bundle ID（`com.electron.open-typeless`）一致，否则 macOS 不会弹出麦克风授权。

ad-hoc 签名在每次重新打包后都会改变，macOS 可能会再次询问钥匙串、麦克风和辅助功能权限。正式分发前需要在 `forge.config.ts` 的 `packagerConfig.osxSign` 中配置固定的签名证书。

## 技术栈

- **Electron** - 桌面应用框架
- **React** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **whisper.cpp** - 本地语音识别
- **better-sqlite3 + Drizzle** - 本地数据库
- **uiohook-napi** - 全局键盘监听
- **node-insert-text** - 文字插入

## 常见问题

### Q: 提示 "Cannot reach whisper.cpp server"？

whisper.cpp 服务器没有运行，或地址不对。按「启动 whisper.cpp 服务器」一节启动后即可使用，无需重启应用。

### Q: 每次都插入 "Thank you." 之类的文字？

这是 whisper 在收到静音时产生的幻觉文字，通常表示没有录到声音：

1. 确认应用已获得麦克风权限（「系统设置」-「隐私与安全性」-「麦克风」）
2. 打包版若不在麦克风列表中，请重新执行 `pnpm package`，确认签名标识为 `com.electron.open-typeless`：`codesign -dv out/open-typeless-darwin-arm64/open-typeless.app`

### Q: 中文被识别成英文？

whisper.cpp 服务器启动时需要加上 `-l auto`，或在 `.env` 中设置 `WHISPER_LANGUAGE=zh`。

### Q: 快捷键没有反应？

确认已授权「辅助功能」和「输入监控」。未授权辅助功能时，应用会弹出说明；授权后会自动启用，无需重启。

### Q: 文字无法插入？

1. 确保光标在文本输入区域
2. 检查「辅助功能」权限
3. 确认设置 `input.autoInsert` 没有被关闭

### Q: 专有名词识别不准？

whisper 对产品名等专有名词容易误认，例如把 Typeless 识别成 timeless。自定义词汇表在后续计划中。

### Q: 如何更换快捷键？

目前快捷键固定为右 Option 键。如需自定义，可修改 `src/main/services/keyboard/keyboard.service.ts` 中的 `triggerKey` 配置。

## License

MIT
