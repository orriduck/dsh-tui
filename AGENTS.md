# AGENTS.md

## Product boundary

`dsh-tui` is a thin, same-process UI bundle for DeepSeek Harness. DSH owns the agent loop, credentials, models, tools, persistence, sandbox, and permission policy. Do not duplicate or bypass those systems here.

The product goal is a one-command, current-directory workflow with durable continuation. Prefer a small reliable terminal surface over Web-client feature parity.

## Development

- Node.js 22+ and pnpm are required.
- Use `pnpm install --registry=https://registry.npmjs.org`; some local pnpm configurations point at mirrors that do not contain preview DeepSeek packages.
- Run `pnpm check`, `pnpm test`, and `pnpm build` before committing.
- Commit `dist/`: GitHub installations intentionally do not run a prepare build.
- For live local testing, register the checkout with `dsh plugin --profile tui add link:.`.
- Never commit API keys, DSH credential files, session logs, or environment files.

## Compatibility

DeepSeek Harness is a developer preview. Keep all `@deepseek-ai/*` peer and development versions aligned with the supported `@deepseek-ai/dsh` release, and verify a real profile boot after any version change.
