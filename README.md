# dsh-tui

A small terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), built as an out-of-tree DSH profile bundle.

It is intentionally optimized for one-person daily use: start in the current directory, chat immediately, close the terminal, and continue the same workspace later.

![dsh-tui running in a terminal](docs/assets/dsh-tui.png)

## Quick start

Open a terminal in the project you want DeepSeek to work on:

```bash
cd /path/to/your/project
dsh-tui
```

To continue the newest session for that same project later:

```bash
cd /path/to/your/project
dsh-tui -c
```

## Install

Requirements: Node.js 22+, `pnpm`, and the official DeepSeek Harness CLI.

```bash
npm install -g @deepseek-ai/dsh
npm install -g github:orriduck/dsh-tui
```

Then enter any project and run:

```bash
cd /path/to/your/project
dsh-tui
```

The first launch creates the local `tui` profile and registers this bundle automatically. DSH remains responsible for credentials, model settings, sessions, tools, sandboxing, and approvals.

## Daily use

```bash
dsh-tui                         # new session in the current directory
dsh-tui -c                      # continue the newest session for this directory
dsh-tui "fix the failing test"  # start with a prompt
dsh-tui -r <session-id>         # resume an exact session
```

Inside the UI:

- Enter sends a follow-up; while the agent is running, it steers the current turn.
- `Ctrl+C` cancels a running turn. When idle, it saves and exits.
- `/status`, `/permission`, `/cancel`, `/help`, `/quit`, and `/exit` are available.
- Tool calls, reasoning, approvals, and `ask_user_question` prompts render in the terminal.
- The bottom bar shows the current permission preset (Read only / Workspace write / FULL ACCESS), and `/permission` switches it for this session through DSH's official command — idle only, with a typed `FULL ACCESS` confirmation for full access.

## Herdr integration

When `dsh-tui` runs inside [Herdr](https://herdr.dev), it connects automatically. No separate hook installation is needed.

The bridge reports:

- `working`, `blocked`, and `idle`/`done` lifecycle state
- the current DSH session identity
- the generated session title and `DeepSeek` display label
- clean release when the TUI exits

This makes the DeepSeek tab visible to `herdr agent list`, `get`, and `wait`, including notifications when a background turn finishes or needs an answer. It is inert outside a Herdr-managed pane and never changes DSH credentials or permissions.

Herdr 0.8.0 does not yet include a native `dsh` agent kind, so `herdr agent start --kind dsh` and `herdr agent prompt` are not available yet. Start and type into the TUI normally; native launch/control belongs in a future Herdr integration.

## Appearance

The first launch creates `~/.dsh/tui.json`:

```json
{
  "theme": "system"
}
```

`system` follows the terminal background automatically. It uses a short terminal color probe first, then `COLORFGBG`, then the macOS appearance setting when needed. Set `theme` to `light` or `dark` to pin it instead.

For a one-off override:

```bash
DSH_TUI_THEME=dark dsh-tui
```

Run `/status` inside the TUI to see the resolved theme and where it came from.

## Credentials and permissions

This package never reads or stores a DeepSeek key itself. It uses the normal DSH credential chain, including `~/.dsh/.credentials.yaml` and supported environment variables.

The default DSH permission preset is `workspace-write` with interactive approval. The TUI answers DSH's official `approval/request` and user-question seams; it does not bypass the sandbox. The current preset is always visible in the bottom bar, and `/permission` (bare or with a preset name) switches it through the official `/permission` command — switches are idle-only, affect only the current session, and full access requires typing `FULL ACCESS` to confirm.

## Scope

Included in the first release:

- streaming text and reasoning
- tool activity and results
- interactive approvals and questions
- a persistent permission badge with `/permission` switching (idle-only, full-access confirmation)
- durable sessions and current-directory continuation
- one-command profile bootstrap
- automatic Herdr lifecycle reporting when available

Not included yet: split panes, remote persistence, a graphical session browser, image attachments, native Herdr launch/control, or Web-client parity. Herdr/tmux can own terminal persistence around this TUI if needed.

## Development

```bash
pnpm install --registry=https://registry.npmjs.org
pnpm check
pnpm test
pnpm build

# Use the checkout directly while developing
dsh plugin --profile tui add link:.
dsh --profile tui
```

The official Harness is currently a developer preview. DeepSeek package versions are pinned to `0.1.0-rc.6` so an upstream breaking change is visible instead of silently changing behavior.

## License

MIT
