# Changelog

All notable changes to dsh-tui are documented here. `package.json` is the machine-readable source of the current version; this file explains what changed between releases.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-08-13

### Added

- Built-in DSH `/sessions`, `/new`, and `/resume` commands, with a numbered current-workspace picker and exact session-id resume.
- Safe launcher handoff that flushes the active session before restarting the TUI into a new or resumed session.
- Per-session corruption isolation: unreadable saved logs remain visible in `/sessions` but cannot block or enter the `/resume` picker.

### Changed

- Matched the Codex composer treatment: derive an opaque neutral tint from the terminal's exact OSC 11 background, keep the input surface near-full-width, and render compact status immediately below it.
- Replaced the single-line slash preview with a Codex-style four-row command and skill menu, including descriptions and visible Tab selection.
- Aligned the composer label, completion menu, and compact status to the transcript's root content axis.
- Replaced the text input's painted fake cursor with Ink's real terminal cursor so macOS IME composition stays anchored inside the composer; consecutive key events now update from the latest controlled value.

## [0.4.1] - 2026-08-13

### Changed

- Kept the composer as one continuous neutral surface and added a full blank row between input and bottom-aligned status.

## [0.4.0] - 2026-08-13

### Added

- Installed DSH version in the status bar and `/status` output.
- A non-blocking official npm registry check with an exact upgrade command when a newer DSH release exists.
- Complete English and Simplified Chinese README documents.
- A theme-aware neutral composer surface with compact two-line status and no repeated raw sandbox row.

### Changed

- Published documentation and the changelog are now explicitly included in the npm package.

## [0.3.1] - 2026-08-13

### Changed

- Made the composer the only persistent bordered surface.
- Moved permission, model, context, and shortcut state beneath the composer with deliberate narrow-terminal line grouping.
- Refreshed all README screenshots for the new layout.

## [0.3.0] - 2026-08-13

### Added

- Context-window usage and token totals in the UI and `/status`.
- `/skills`, direct skill invocation visibility, skill tool labels, and slash completion.
- Always-visible permission, sandbox, and approval state.

## [0.2.1] - 2026-08-13

### Fixed

- Tool rows now transition reliably from running to their durable result.

### Changed

- Batched history projection and reduced latest-session lookup overhead.
- Removed unused state and internal exports.

## [0.2.0] - 2026-08-13

### Added

- Automatic Herdr lifecycle, identity, title, and display-label reporting.

## [0.1.1] - 2026-08-13

### Added

- System-aware light/dark theme resolution with `~/.dsh/tui.json` configuration.
- Initial README screenshot and current-directory quick start.

## [0.1.0] - 2026-08-13

### Added

- Initial same-process DeepSeek Harness TUI bundle.
- Streaming text and reasoning, tool rows, approvals, questions, cancellation, status, and durable session continuation.

[0.5.0]: https://github.com/orriduck/dsh-tui/compare/9914fe7...HEAD
[0.4.1]: https://github.com/orriduck/dsh-tui/compare/03ee02d...9914fe7
[0.4.0]: https://github.com/orriduck/dsh-tui/compare/d69fd3f...03ee02d
[0.3.1]: https://github.com/orriduck/dsh-tui/compare/06ceacd...d69fd3f
[0.3.0]: https://github.com/orriduck/dsh-tui/compare/a1325b7...06ceacd
[0.2.1]: https://github.com/orriduck/dsh-tui/compare/10f73e1...4829e80
[0.2.0]: https://github.com/orriduck/dsh-tui/compare/2a1dd81...10f73e1
[0.1.1]: https://github.com/orriduck/dsh-tui/compare/a1626c0...2a1dd81
[0.1.0]: https://github.com/orriduck/dsh-tui/releases/tag/v0.1.0
