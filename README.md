# dsh-tui

A small terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), built as an out-of-tree DSH profile bundle.

It is intentionally optimized for one-person daily use: start in the current directory, chat immediately, close the terminal, and continue the same workspace later.

## Install

Requirements: Node.js 22+, `pnpm`, and the official DeepSeek Harness CLI.

```bash
npm install -g @deepseek-ai/dsh
npm install -g github:orriduck/dsh-tui
```

Then run:

```bash
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
- `/status`, `/cancel`, `/help`, `/quit`, and `/exit` are available.
- Tool calls, reasoning, approvals, and `ask_user_question` prompts render in the terminal.

## Credentials and permissions

This package never reads or stores a DeepSeek key itself. It uses the normal DSH credential chain, including `~/.dsh/.credentials.yaml` and supported environment variables.

The default DSH permission preset is `workspace-write` with interactive approval. The TUI answers DSH's official `approval/request` and user-question seams; it does not bypass the sandbox.

## Scope

Included in the first release:

- streaming text and reasoning
- tool activity and results
- interactive approvals and questions
- durable sessions and current-directory continuation
- one-command profile bootstrap

Not included yet: split panes, remote persistence, a graphical session browser, image attachments, or Web-client parity. Herdr/tmux can own terminal persistence around this TUI if needed.

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
