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

Paste this into DSH's **Settings → Plugins → install** entry:

```
github:Seelerc/dsh-plugin-delete-archived
```

Or just ask the agent to install it — `plugin_manager`, `action: "install_bundle"`, `target: "github:Seelerc/dsh-plugin-delete-archived"`.

---

## HTTP API

Routes registered on DSH's web server, for scripts and integrations.

| Method | Path | Body | Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/archived-sessions` | — | `{ sessions: ArchivedSession[] }` |
| `POST` | `/api/archived-sessions/delete` | `{ sessionId }` | single-delete result |
| `POST` | `/api/archived-sessions/delete-batch` | `{ sessionIds? }` | `{ total, deletedCount, errors }` |
| `POST` | `/api/archived-sessions/restore` | `{ sessionId }` | `{ success, sessionId }` |
| `POST` | `/api/archived-sessions/restore-batch` | `{ sessionIds }` | `{ success, restoredCount }` |
| `POST` | `/api/archived-sessions/open-folder` | `{ path }` | `{ success }` |

Omitting `sessionIds` on `delete-batch` means "delete every archived session".

```ts
interface ArchivedSession {
  id: string;
  title: string;
  cwd?: string;
  workspaceTitle: string;
  diskPath: string;         // placeholder when no standalone directory is found
  sizeBytes: number;
  sizeFormatted: string;    // e.g. "1.2 MB"
  createdAt: string | null; // ISO 8601
}
```

---

## Project layout

```
dsh-plugin-delete-archived/
├── lib/
│   ├── index.js          # backend: HTTP routes, agent tool, disk cleanup
│   └── client.js         # frontend: settings page + sidebar menu (AMD loader)
├── locale/
│   ├── zh.json           # Chinese strings
│   └── en.json           # English strings
├── cordis.patch.yml      # loader injection declaration
└── package.json          # manifest: exports / dsh.bundle / dsh.client
```

---

## How it works

- **Locating the directory**: tries `sessionPersistence.findLog(sessionId)` first, then falls back to scanning `persistence.root` for a directory named after the encoded session id.
- **Permanent delete**: erases the disk directory → detaches the session from its workspace → removes it from the archived set → clears the persistence handles and caches.
- **Frontend injection**: the client registers via `window.__ModuleLoader__.load()` and injects into the `settings.section` and `sidebar.workspaces.session.menu.item` slots.

---

## ⚠️ Warning

"Delete Permanently" is irreversible — it truly erases session history and log files from disk. **No recycle bin, no recovery.** Every delete entry point asks for confirmation, but please double-check that you no longer need the session. If you only want it out of the sidebar, DSH's native *Archive* is enough.

---

## Development

Plain JavaScript, no build step. Edit `lib/client.js` and the change applies immediately while the DSH client-plugin HMR receiver is active; otherwise restart DSH.

---

## License

[MIT](LICENSE)
