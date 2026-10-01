import { rm, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * 将原始 session id 编码为安全的文件系统路径段 (与 DSH 内部 encodeSegment 保持一致)
 */
function encodeSegment(raw) {
  if (!raw || raw.length === 0) throw new Error('cannot encode empty segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch;
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  return out;
}

/**
 * 定位会话在物理磁盘上的实际存储目录
 */
async function resolveSessionDiskPath(persistence, sessionId) {
  if (!persistence) return null;

  // 策略 1: 通过 persistence.findLog 精确定位
  if (typeof persistence.findLog === 'function') {
    try {
      const selected = await persistence.findLog(sessionId);
      if (selected?.sourcePath) {
        return dirname(selected.sourcePath);
      }
    } catch {
      // 降级到策略 2
    }
  }

  // 策略 2: 扫描 persistence.root 下的项目目录匹配 encodedId
  if (persistence.root) {
    const encodedId = encodeSegment(sessionId);
    try {
      const rootDir = persistence.root;
      const entries = await readdir(rootDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const targetDir = join(rootDir, entry.name, encodedId);
        try {
          const st = await stat(targetDir);
          if (st.isDirectory()) return targetDir;
        } catch {
          // 不存在则继续下一个目录
        }
      }
    } catch {
      // 忽略目录扫描错误
    }
  }

  return null;
}

/**
 * 安全删除物理磁盘上的会话目录
 */
async function removeSessionDiskArtifacts(persistence, sessionId) {
  const diskPath = await resolveSessionDiskPath(persistence, sessionId);
  if (diskPath) {
    await rm(diskPath, { recursive: true, force: true });
    return true;
  }
  return false;
}

/**
 * 递归计算目录占用的实际字节大小
 */
async function getDirSizeBytes(dirPath) {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      const full = join(dirPath, ent.name);
      if (ent.isFile()) {
        const st = await stat(full);
        total += st.size;
      } else if (ent.isDirectory()) {
        total += await getDirSizeBytes(full);
      }
    }
  } catch {
    // 忽略无法访问的子文件
  }
  return total;
}

/**
 * 格式化字节大小为可读字符串
 */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * 核心删除操作：永久安全删除一个处于归档状态的会话
 */
async function deleteArchivedSession(ctx, sessionId) {
  const workspaceRegistry = ctx.workspaceRegistry;
  if (!workspaceRegistry) {
    throw new Error('workspaceRegistry service not available');
  }

  const archivedIds = workspaceRegistry.archivedSessionIds || [];
  if (!archivedIds.includes(sessionId)) {
    throw new Error(`会话 ${sessionId} 未处于归档状态，出于安全保护拒绝删除！`);
  }

  const logger = ctx.logger;

  // 1. 停止该会话相关的运行与调度
  try {
    await ctx.parallel('workspace/session-stop', { sessionId });
  } catch (err) {
    logger?.warn?.(`停止会话 ${sessionId} 失败: ${String(err)}`);
  }

  // 2. 清理内存会话实例
  try {
    const sessions = ctx.sessions;
    if (sessions?.store?.has?.(sessionId)) {
      sessions.store.delete(sessionId);
    }
  } catch (err) {
    logger?.debug?.(`清理内存会话 ${sessionId} 失败: ${String(err)}`);
  }

  // 3. 清理 persistence 句柄与缓存
  try {
    const persistence = ctx.sessionPersistence;
    if (persistence) {
      persistence.coldLogMemo?.delete?.(sessionId);
      const tracker = persistence.tracker;
      if (tracker?.writers?.has?.(sessionId)) {
        const handle = tracker.writers.get(sessionId);
        try {
          await handle?.close?.();
        } catch {}
        tracker.writers.delete(sessionId);
      }
      tracker?.pending?.delete?.(sessionId);
    }
  } catch (err) {
    logger?.debug?.(`清理 persistence 句柄 ${sessionId} 失败: ${String(err)}`);
  }

  // 4. 从工作区持久状态中彻底解绑
  await workspaceRegistry.unarchiveSession(sessionId);

  // 从各个工作区实体的 sessionIds 中解绑
  if (workspaceRegistry.entities) {
    for (const entity of workspaceRegistry.entities.values()) {
      if (Array.isArray(entity.record?.sessionIds) && entity.record.sessionIds.includes(sessionId)) {
        try {
          await entity.detachSession(sessionId);
        } catch (err) {
          logger?.warn?.(`从工作区 ${entity.path} 解绑会话 ${sessionId} 失败: ${String(err)}`);
        }
      }
    }
  }

  // 清除 workspaceRegistry 内部内存索引
  workspaceRegistry.headers?.delete?.(sessionId);
  workspaceRegistry.sessionPaths?.delete?.(sessionId);
  workspaceRegistry.invalidSessionPaths?.delete?.(sessionId);

  // 5. 物理删除磁盘日志文件及整个会话文件夹
  try {
    const persistence = ctx.sessionPersistence;
    await removeSessionDiskArtifacts(persistence, sessionId);
  } catch (err) {
    logger?.warn?.(`删除会话 ${sessionId} 磁盘文件失败: ${String(err)}`);
  }

  return { success: true, sessionId };
}

/**
 * 批量执行归档会话删除
 */
async function deleteArchivedSessionsBatch(ctx, targetIds) {
  let deletedCount = 0;
  const errors = [];

  for (const id of targetIds) {
    try {
      await deleteArchivedSession(ctx, id);
      deletedCount++;
    } catch (err) {
      errors.push({ id, error: String(err?.message || err) });
    }
  }

  return {
    success: true,
    deletedCount,
    total: targetIds.length,
    errors,
  };
}

/**
 * 获取所有已归档会话的完整信息列表
 */
async function getArchivedSessionsInfo(ctx) {
  const workspaceRegistry = ctx.workspaceRegistry;
  if (!workspaceRegistry) return [];

  const archivedIds = workspaceRegistry.archivedSessionIds || [];
  const persistence = ctx.sessionPersistence;
  const sessionQuery = ctx.sessionQuery;

  // 建立工作区路径到标题的映射缓存
  const workspaceTitleMap = new Map();
  if (workspaceRegistry.entities) {
    for (const entity of workspaceRegistry.entities.values()) {
      if (entity?.path) {
        workspaceTitleMap.set(entity.path, entity.title || entity.path);
      }
    }
  }

  const results = [];

  for (const id of archivedIds) {
    let title = id;
    let cwd = undefined;
    let createdAt = undefined;

    const header = workspaceRegistry.headers?.get(id);
    if (header) {
      cwd = header.cwd;
      createdAt = header.createdAt;
    }

    if (sessionQuery?.readTitle) {
      try {
        const titleSnapshot = await sessionQuery.readTitle(id);
        if (titleSnapshot?.title) {
          title = titleSnapshot.title;
        }
      } catch {}
    }

    const workspaceTitle = (cwd && workspaceTitleMap.get(cwd)) || '未分组';

    // 定位物理存储目录与占用空间
    const diskPath = await resolveSessionDiskPath(persistence, id);
    const sizeBytes = diskPath ? await getDirSizeBytes(diskPath) : 0;

    results.push({
      id,
      title,
      cwd,
      workspaceTitle,
      diskPath: diskPath || '未定位到独立物理目录',
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    });
  }

  // 默认顺序：从旧往新（旧在上，新在下）
  results.sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return timeA - timeB;
  });

  return results;
}

// ==================== HTTP API 辅助工具 ====================

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function sendError(res, message, status = 400) {
  sendJson(res, { error: String(message) }, status);
}

// ==================== 插件主体导出 ====================

export const name = 'dsh-plugin-delete-archived';
export const inject = [
  'webServer',
  'workspaceRegistry',
  'tools',
  'sessions',
  'sessionPersistence',
  'sessionQuery',
];

export function apply(ctx) {
  ctx.logger?.info?.('已归档会话删除插件已激活');

  const webServer = ctx.webServer;
  const workspaceRegistry = ctx.workspaceRegistry;
  const tools = ctx.tools;

  if (webServer) {
    // 1. 获取所有已归档会话
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/archived-sessions',
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendError(res, 'Method Not Allowed', 405);
        try {
          const list = await getArchivedSessionsInfo(ctx);
          sendJson(res, { sessions: list });
        } catch (e) {
          sendError(res, e.message || e, 500);
        }
      },
    }), 'archived-sessions: GET /api/archived-sessions');

    // 2. 删除单个已归档会话
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/archived-sessions/delete',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
        try {
          const { sessionId } = await readJsonBody(req);
          if (!sessionId) return sendError(res, 'sessionId is required', 400);
          const result = await deleteArchivedSession(ctx, sessionId);
          sendJson(res, result);
        } catch (e) {
          sendError(res, e.message || e, 400);
        }
      },
    }), 'archived-sessions: POST /api/archived-sessions/delete');

    // 3. 批量/全部删除已归档会话
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/archived-sessions/delete-batch',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
        try {
          const body = await readJsonBody(req);
          const targetIds = Array.isArray(body.sessionIds)
            ? body.sessionIds
            : [...(workspaceRegistry?.archivedSessionIds || [])];

          const result = await deleteArchivedSessionsBatch(ctx, targetIds);
          sendJson(res, result);
        } catch (e) {
          sendError(res, e.message || e, 500);
        }
      },
    }), 'archived-sessions: POST /api/archived-sessions/delete-batch');

    // 4. 恢复单个已归档会话
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/archived-sessions/restore',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
        try {
          const { sessionId } = await readJsonBody(req);
          if (!sessionId) return sendError(res, 'sessionId is required', 400);
          await workspaceRegistry.unarchiveSession(sessionId);
          sendJson(res, { success: true, sessionId });
        } catch (e) {
          sendError(res, e.message || e, 400);
        }
      },
    }), 'archived-sessions: POST /api/archived-sessions/restore');

    // 5. 批量恢复已归档会话
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/archived-sessions/restore-batch',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
        try {
          const body = await readJsonBody(req);
          const targetIds = Array.isArray(body.sessionIds) ? body.sessionIds : [];
          let restoredCount = 0;
          for (const id of targetIds) {
            try {
              await workspaceRegistry.unarchiveSession(id);
              restoredCount++;
            } catch {}
          }
          sendJson(res, { success: true, restoredCount });
        } catch (e) {
          sendError(res, e.message || e, 500);
        }
      },
    }), 'archived-sessions: POST /api/archived-sessions/restore-batch');

    // 6. 跨平台在系统资源管理器中打开物理文件夹
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/archived-sessions/open-folder',
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);
        try {
          const { path: folderPath } = await readJsonBody(req);
          if (folderPath && typeof folderPath === 'string') {
            const { spawn } = await import('node:child_process');
            const platform = process.platform;
            if (platform === 'win32') {
              spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' }).unref();
            } else if (platform === 'darwin') {
              spawn('open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
            } else {
              spawn('xdg-open', [folderPath], { detached: true, stdio: 'ignore' }).unref();
            }
          }
          sendJson(res, { success: true });
        } catch (e) {
          sendError(res, e.message || e, 500);
        }
      },
    }), 'archived-sessions: POST /api/archived-sessions/open-folder');
  }

  // 注册 Agent Tool (供对话中调用)
  if (tools) {
    ctx.effect(() => tools.register({
      name: 'delete_archived_sessions',
      description: '彻底删除已经归档过的会话记录和磁盘日志文件。可指定单个会话 id 或删除全部已归档会话。未归档会话不会被删除。',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: '可选：要删除的已归档会话 ID。如果不提供，将删除所有已归档的会话。',
          },
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute({ session_id }) {
        if (session_id) {
          try {
            await deleteArchivedSession(ctx, session_id);
            return `已成功彻底删除已归档会话：${session_id}`;
          } catch (e) {
            return `删除会话 ${session_id} 失败: ${e.message || String(e)}`;
          }
        }

        const allArchived = [...(workspaceRegistry?.archivedSessionIds || [])];
        if (allArchived.length === 0) {
          return '当前没有已归档的会话。';
        }

        const result = await deleteArchivedSessionsBatch(ctx, allArchived);
        let msg = `已彻底删除 ${result.deletedCount}/${result.total} 个已归档会话。`;
        if (result.errors.length > 0) {
          msg += `\n失败项：\n` + result.errors.map((e) => `${e.id}: ${e.error}`).join('\n');
        }
        return msg;
      },
    }), 'tool: delete_archived_sessions');
  }
}
