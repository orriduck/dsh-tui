# dsh-tui

[English](README.md) · [更新日志](CHANGELOG.md)

一个为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 制作的小型终端 UI，以独立的 DSH profile bundle 形式运行。

它面向个人日常使用：在当前目录启动、立即对话、关闭终端，并在之后继续同一 workspace 的会话。

![dsh-tui workspace 会话，显示权限和上下文用量](docs/assets/dsh-tui-session.png)

## 快速开始

在希望 DeepSeek 操作的项目目录中打开终端：

```bash
cd /path/to/your/project
dsh-tui
```

之后要继续该目录最新的会话：

```bash
cd /path/to/your/project
dsh-tui -c
```

## 安装

需要 Node.js 22+、`pnpm` 和官方 DeepSeek Harness CLI。

```bash
npm install -g @deepseek-ai/dsh
npm install -g github:orriduck/dsh-tui
```

然后进入任意项目并运行：

```bash
cd /path/to/your/project
dsh-tui
```

首次启动会自动创建本地 `tui` profile 并注册这个 bundle。凭据、模型设置、会话、工具、sandbox 和审批仍全部由 DSH 管理。

## 日常使用

```bash
dsh-tui                         # 在当前目录创建新会话
dsh-tui -c                      # 继续该目录最新会话
dsh-tui "fix the failing test"  # 带初始任务启动
dsh-tui -r <session-id>         # 恢复指定会话
```

界面操作：

- Enter 发送后续消息；agent 运行中输入会 steer 当前 turn。
- Composer 使用终端真实光标，让 macOS 输入法的拼音预编辑和候选窗口跟随文本插入位置。
- `Ctrl+C` 在运行中取消 turn，idle 时保存并退出。
- `/sessions` 列出当前目录最近保存的 10 个会话；`/resume` 打开编号选择器，`/resume <session-id>` 直接切换，`/new` 新建会话。切换只能在 idle 时进行，TUI 重启前会先完整保存当前会话。损坏的历史日志会标为 unreadable，不会阻断其余列表，也不会进入恢复选择器。
- 内置 `/status`、`/permission`、`/skills`、`/sessions`、`/new`、`/resume`、`/cancel`、`/help`、`/quit` 和 `/exit`。
- 工具调用、reasoning、审批和 `ask_user_question` 都直接显示在终端里。
- 几乎占满终端宽度的连续中性 composer 收纳输入，并在上下各留一行呼吸空间。与 Codex 一样，它会探测终端实际背景，并在浅色背景上混入 4% 黑色、深色背景上混入 12% 白色，再绘制为不透明 RGB；ANSI 本身没有逐单元格 alpha。紧凑状态栏紧贴在面板下方，显示模型状态、已安装 DSH 版本和累计 context 用量，不重复默认 workspace sandbox。非默认权限仍会显示，Full Access 会重点警示。`/permission` 通过 DSH 官方命令切换当前会话权限；只能在 idle 时切换，Full Access 还必须输入 `FULL ACCESS` 确认。
- `/skills` 列出用户可调用的 skills。输入 `/skill-name` 可直接加载；slash command 和 skill catalog 会在 composer 下方显示带说明的紧凑菜单，并支持 Tab 补全。

## 界面状态

Slash 补全同时包含内置命令和当前 DSH skill catalog：

![dsh-tui 显示 skill 和 slash command 补全](docs/assets/dsh-tui-completion.png)

Full Access 在输入确认后仍保持醒目的警告状态：

![dsh-tui 显示 Full Access 权限警告](docs/assets/dsh-tui-full-access.png)

## Herdr 集成

`dsh-tui` 在 [Herdr](https://herdr.dev) 内运行时会自动连接，不需要另装 hook。

Bridge 会上报：

- `working`、`blocked`、`idle`/`done` 生命周期状态
- 当前 DSH session identity
- 自动生成的会话标题和 `DeepSeek` display label
- TUI 退出时的干净 release

因此 DeepSeek tab 会出现在 `herdr agent list`、`get` 和 `wait` 中，后台 turn 完成或需要回答时也能触发通知。Herdr 外运行时 bridge 完全不工作，也不会改变 DSH 的凭据或权限。

Herdr 0.8.0 尚未内置原生 `dsh` agent kind，因此暂不支持 `herdr agent start --kind dsh` 和 `herdr agent prompt`。目前仍从终端正常启动并输入；原生启动与控制属于未来的 Herdr 集成。

## 外观

首次启动会创建 `~/.dsh/tui.json`：

```json
{
  "theme": "system"
}
```

`system` 会自动跟随终端背景：先用短时 OSC 11 探测并保留返回的精确 RGB，用它计算 Codex 式 composer 色；拿不到精确 RGB 时，再依次尝试 `COLORFGBG`、macOS 外观，最后回退到 dark。将 `theme` 改为 `light` 或 `dark` 可以固定主题。

单次覆盖：

```bash
DSH_TUI_THEME=dark dsh-tui
```

在 TUI 中运行 `/status` 可查看最终主题及其来源。

## DSH 版本与更新

状态栏通过 `dsh --version` 读取本机实际安装的 Harness 版本。启动后会异步访问 npm 官方 registry，检查是否存在更高版本的 `@deepseek-ai/dsh`。发现更新时，状态栏会直接显示精确安装命令，例如：

```bash
npm install -g @deepseek-ai/dsh@0.1.0-rc.7
```

检查有很短的超时，离线时静默降级，不会阻塞 TUI。设置 `DSH_TUI_UPDATE_CHECK=0` 可关闭 registry 请求。DeepSeek Harness 仍处于 developer preview；跨 preview 版本升级前请查看[更新日志](CHANGELOG.md)和兼容性说明。

## 凭据与权限

本包不会自行读取或存储 DeepSeek API key，而是使用 DSH 的标准凭据链，包括 `~/.dsh/.credentials.yaml` 和受支持的环境变量。

DSH 默认权限 preset 是带交互审批的 `workspace-write`。TUI 接入 DSH 官方 `approval/request` 和用户问答接口，不绕过 sandbox。当前 preset 保留在 composer 状态栏中，底层 sandbox/approval 事实可通过 `/status` 查看；`/permission`（可带 preset 参数）通过官方命令切换，仅影响当前 session、只能在 idle 时操作，进入 Full Access 必须输入 `FULL ACCESS` 确认。

## 范围

已包含：

- 流式文本与 reasoning
- 工具活动与结果
- 交互审批和问题
- 常驻权限状态与 `/permission` 切换
- context window 用量和 token totals
- 已安装 DSH 版本与可选 npm 更新提示
- skill 发现、直接调用可见性和 Tab 补全
- 持久会话、按当前目录继续，以及 TUI 内的 list/new/resume 命令
- 一条命令完成 profile 初始化
- 在 Herdr 环境中的自动生命周期上报

暂不包含：split panes、远端持久化、跨 workspace 的图形化 session browser、图片附件、原生 Herdr 启动/控制或 Web client 全量功能。终端持久化可继续交给 Herdr/tmux。

## 开发

```bash
pnpm install --registry=https://registry.npmjs.org
pnpm check
pnpm test
pnpm build

# 开发时直接使用当前 checkout
dsh plugin --profile tui add link:.
dsh --profile tui
```

官方 Harness 当前仍是 developer preview。DeepSeek 依赖固定为 `0.1.0-rc.6`，使上游破坏性变化显式暴露，而不是静默改变行为。

版本历史维护在 [CHANGELOG.md](CHANGELOG.md)；`package.json` 仍是 dsh-tui 当前版本的机器可读真源。

## License

MIT
