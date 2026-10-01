# dsh-plugin-delete-archived

**彻底删除 DeepSeek Harness 已归档会话与磁盘日志。**

DSH 自带的「归档」只是把会话从侧边栏收起来 —— 磁盘上的会话历史与日志依然完整保留。本插件补上最后一环：把已归档会话连同它的物理目录一起真正抹除，同时保留「恢复」这条退路。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) | **简体中文**

---

## 功能

**设置 → 已归档会话**

列出全部已归档会话：标题、磁盘目录、占用空间、归档时间、所属工作区。支持逐条勾选与全选，批量 **恢复** 或 **彻底删除**。默认按归档时间由旧到新排列，所有删除入口都会先弹确认框。

**侧边栏会话菜单**

已归档会话的「⋯」菜单里会多出一项 **彻底删除会话**。

**Agent 工具**

`delete_archived_sessions`：传 `session_id` 删除指定会话；不传则删除全部已归档会话。未归档的会话永远不会被它碰到。

---

## 安装

走 DSH 自带的插件管理，它接受一个安装 spec：git 主机简写、仓库 URL，或者本地绝对路径。

spec：

```
github:Seelerc/dsh-plugin-delete-archived
```

等价写法：

```
https://github.com/Seelerc/dsh-plugin-delete-archived
```

把 spec 交给 DSH：

- **在应用里**：设置 → 插件 → 安装入口，粘贴 spec。
- **在会话里**：让 Agent 装 —— `plugin_manager`，`action: "install_bundle"`，`target: "github:Seelerc/dsh-plugin-delete-archived"`。

可以用 `#` 钉住某个 ref，例如 `github:Seelerc/dsh-plugin-delete-archived#v1.0.0`。

---

## ⚠️ 注意

「彻底删除」不可撤销 —— 它会真正抹除磁盘上的会话历史与日志文件，**没有回收站，无法恢复**。插件所有删除入口都做了二次确认，但仍请确认目标会话确实不再需要。若只是想把它从侧边栏移走，用 DSH 原生的「归档」即可。

---

## 许可证

[MIT](LICENSE)
