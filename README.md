# dsh-plugin-delete-archived

**Permanently delete archived DeepSeek Harness sessions and their on-disk logs.**

DSH's built-in *archive* only hides a session from the sidebar — its history and log files stay on disk. This plugin erases an archived session together with its physical directory, while keeping **restore** as a way back.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

---

## Features

**Settings → Archived Sessions**

Lists every archived session with its disk directory, size, archive time and workspace. Rows are selectable, with batch **Restore** and **Delete Permanently**. Sorted oldest first by default, and every destructive action asks for confirmation first.

**Sidebar session menu**

Archived sessions gain a **Delete Permanently** entry in their "⋯" menu.

**Agent tool**

`delete_archived_sessions` removes one session by `session_id`, or every archived session when `session_id` is omitted. Sessions that are not archived are never touched.

---

## Install

DSH's built-in plugin manager takes an install spec — a git host shorthand, a repository URL, or a local absolute path.

GitHub shorthand:

```
github:Seelerc/dsh-plugin-delete-archived
```

Equivalent:

```
https://github.com/Seelerc/dsh-plugin-delete-archived
```

Hand the spec to DSH:

- **In the app**: Settings → Plugins → install entry, paste the spec.
- **In a session**: ask the agent to install it — `plugin_manager`, `action: "install_bundle"`, `target: "github:Seelerc/dsh-plugin-delete-archived"`.

Pin a specific ref with `#`, e.g. `github:Seelerc/dsh-plugin-delete-archived#v1.0.0`.

---

## ⚠️ Warning

"Delete Permanently" is irreversible — it truly erases session history and log files from disk. **No recycle bin, no recovery.** Every delete entry point asks for confirmation, but please double-check that you no longer need the session. If you only want it out of the sidebar, DSH's native *Archive* is enough.

---

## License

[MIT](LICENSE)
