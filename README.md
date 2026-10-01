# dsh-plugin-delete-archived

**Permanently delete archived DeepSeek Harness sessions and their on-disk logs.**

DeepSeek Harness's built-in *archive* only hides a session from the sidebar — the conversation history and log files stay on disk. This plugin adds the missing piece: it wipes an archived session together with its physical directory, while keeping **restore** as a way back.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

---

## Features

### Settings → Archived Sessions

- Lists every archived session: **title**, **disk directory**, **size**, **archived at**, **workspace**
- Sorted by archive time, **oldest first**
- Per-row checkbox plus select-all, with batch **Restore** and **Delete Permanently**
- Destructive actions require confirmation, and the dialog spells out exactly which directory will be erased

### Sidebar session menu

Any archived session's "⋯" menu gains a **Delete Permanently** entry.

### Agent tool

The `delete_archived_sessions` tool lets the agent clean up for you:

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `session_id` | `string` (optional) | A specific archived session to delete. **Omit it to delete every archived session.** |

Sessions that are not archived are never touched.

### Internationalization

Follows the DSH language setting and switches **live, with no restart**. Only Chinese locales get Chinese; every other locale falls back to English.

---

## Installation

The plugin mounts through your DSH profile's `dependencies` plus `dsh.profile.bundles`. Locate your profile directory (usually `~/.dsh/profiles/web` or `~/.dsh/profiles/desktop`) and edit its `package.json`.

### Option 1 — from GitHub (recommended)

```jsonc
{
  "dependencies": {
    "dsh-plugin-delete-archived": "github:Seelerc/dsh-plugin-delete-archived"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...other bundles
        "dsh-plugin-delete-archived"
      ]
    }
  }
}
```

### Option 2 — local link (for development)

```jsonc
{
  "dependencies": {
    "dsh-plugin-delete-archived": "link:/absolute/path/to/dsh-plugin-delete-archived"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // ...other bundles
        "dsh-plugin-delete-archived"
      ]
    }
  }
}
```

Then run this inside the profile directory:

```bash
pnpm install
```

Restart DSH (or trigger a profile reload) and the plugin is active.

---

## HTTP API

The plugin registers these routes on DSH's web server, for the client and for scripting.

| Method | Path | Body | Response |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/archived-sessions` | — | `{ sessions: ArchivedSession[] }` |
| `POST` | `/api/archived-sessions/delete` | `{ sessionId }` | single-delete result |
| `POST` | `/api/archived-sessions/delete-batch` | `{ sessionIds? }` | `{ total, deletedCount, errors }` |
| `POST` | `/api/archived-sessions/restore` | `{ sessionId }` | `{ success, sessionId }` |
| `POST` | `/api/archived-sessions/restore-batch` | `{ sessionIds }` | `{ success, restoredCount }` |
| `POST` | `/api/archived-sessions/open-folder` | `{ path }` | `{ success }` |

Omitting `sessionIds` on `delete-batch` means "delete every archived session".

`ArchivedSession` shape:

```ts
interface ArchivedSession {
  id: string;
  title: string;
  cwd?: string;
  workspaceTitle: string;   // "未分组" when the session belongs to no workspace
  diskPath: string;         // placeholder text when no standalone directory is found
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
│   ├── index.js          # Backend: HTTP routes, agent tool, disk cleanup
│   └── client.js         # Frontend: settings page + sidebar menu (AMD loader)
├── locale/
│   ├── zh.json           # Chinese strings
│   └── en.json           # English strings
├── cordis.patch.yml      # loader injection declaration
└── package.json          # manifest: exports / dsh.bundle / dsh.client
```

---

## How it works

- **Locating the physical directory**: it first tries `sessionPersistence.findLog(sessionId)`; if that fails it falls back to scanning `persistence.root` for a directory named after the encoded session id.
- **Permanent delete**: erases the disk directory → detaches the session from its workspace → removes it from the archived set → clears the persistence handles and caches.
- **Frontend injection**: the client registers itself via `window.__ModuleLoader__.load()` and injects components into the `settings.section` and `sidebar.workspaces.session.menu.item` slots.
- **Style isolation**: the components ship a scoped stylesheet built entirely on DSH design-system variables (`--dsw-alias-*` / `--dsw-radius-*`), so light and dark themes both work automatically.

---

## ⚠️ Warning

"Delete Permanently" is irreversible and destructive — it truly erases session history and log files from disk. **There is no recycle bin and no recovery.**

Every delete entry point asks for confirmation, but please double-check that you really no longer need the session. If you only want it out of the sidebar, DSH's native *Archive* is enough.

---

## Development

This plugin is plain JavaScript with no build step. After editing `lib/client.js`, changes apply immediately while the DSH client-plugin HMR receiver is active; otherwise restart DSH.

---

## License

[MIT](LICENSE)
