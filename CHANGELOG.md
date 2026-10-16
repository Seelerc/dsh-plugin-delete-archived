# Changelog

All notable changes to `dsh-plugin-delete-archived`.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-10-16

Cascading subagent deletion: when you permanently delete an archived session you can now
choose which of its derived subagent sessions to take with it.

### Added

- **Optional subagent deletion.** Subagent sessions (`subagent`, `subagent_fork`, `workflow`)
  each own a directory on disk and are **not** removed when their parent is. The delete
  confirmation dialog now lists them so they can be cleared together.
- **Fork-family awareness.** `fork` does not share subagents, so a conversation split into
  branches leaves each branch's subagents invisible from the others. The plugin reconstructs
  the whole family and shows every branch's subagents.
- **Per-subagent selection.** Every subagent row is individually checkable; `label`,
  title, depth, owner and size are shown. Only the current session's own subagents are
  checked by default.
- **Family blocks.** Subagents are grouped into one block per conversation family
  (this session + source conversation + sibling branches), with block-level select-all.
- **Short-id disambiguation.** Fork branches inherit their parent's title, so same-named
  families are told apart by short id on both the block header and the overview chips.

### Fixed

- **Titles were showing directory names.** Session titles were read through
  `sessionQuery.readTitle()`, which only works for live sessions — archived sessions fell
  back to the directory name (`session-xxxxxxxx`). Titles are now read from the session log's
  `session/title` event, falling back to the first user message. Coverage went from
  41/60 to 57/60 on real data.
- **Truncated fallback titles.** DSH hard-truncates auto-generated titles mid-sentence
  (`你是一个测试子代理。请只回`). When the title is a prefix of the complete first user
  input, the full text is shown instead.
- **Full ids leaking into the UI.** A missing title used to fall back to the raw 44-character
  session id, which the frontend could not shorten because the value was truthy.
  The backend now returns `null` and every frontend outlet falls back to the short id.
- **Cascade could miss grandchildren.** A breadth-first traversal pushed the parent id
  instead of the child, so depth-2+ descendants were never collected.
- **Cancel left the dialog stuck.** `processing` was not reset on cancel, permanently
  disabling the toolbar.

### Changed

- Bulk delete now reports how many sessions and subagents were removed.
- Rows show a single name (the descriptor `label` when present) instead of repeating an
  identical title on every row.
- Replaced the naive `Promise.all` fan-out with bounded concurrency (8) for disk measurement.

### Testing

356 offline checks plus real-disk end-to-end verification — including checks driven by
real DSH session lineage rather than hand-written fixtures. See the README's Testing section.

## [1.0.5] — 2025-XX-XX

- Parallelize info fetching, unify route registration, streamline UI.

## [1.0.4]

- Align bulk delete button with official DSH danger outline style for dark mode.

## [1.0.3]

- Auto-clear the main view when deleting the currently active session.

## [1.0.2]

- Enable direct session deletion from the workspace sidebar.

## [1.0.1]

- Initial patch release.

## [1.0.0]

- First release: permanently delete archived sessions and their on-disk logs, with restore.
