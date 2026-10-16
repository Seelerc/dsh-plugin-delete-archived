import { rm, readdir, stat, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import zlib from 'node:zlib';

/**
 * 将原始 session id 编码为安全的文件系统路径段 (与 DSH 内部 encodeSegment 保持一致)
 */
/** 免转义字符集：0-9 A-Z a-z - . _（与 DSH 内部编码一致，`~` 自身必须转义） */
function isPlainSegmentChar(code) {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 45 || // -
    code === 46 || // .
    code === 95 // _
  );
}

function encodeSegment(raw) {
  if (!raw || raw.length === 0) throw new Error('cannot encode empty segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    // 逐字符正则替换是热路径，改为码点判断
    out += isPlainSegmentChar(code) ? raw[i] : '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/**
 * 定位会话在物理磁盘上的实际存储目录。
 *
 * @param persistence - ctx.sessionPersistence
 * @param sessionId - 原始会话 id
 * @param rootDirs - 可选的 persistence.root 子目录名列表；调用方在同一请求内
 *   已经列过时传入，避免每个会话都重新列一遍根目录
 */
async function resolveSessionDiskPath(persistence, sessionId, rootDirs) {
  if (!persistence || !sessionId) return null;

  // 策略 1: 通过 persistence.findLog 精确定位
  if (typeof persistence.findLog === 'function') {
    try {
      const selected = await persistence.findLog(sessionId);
      if (selected?.sourcePath) return dirname(selected.sourcePath);
    } catch {
      // 降级到策略 2
    }
  }

  // 策略 2: 在 persistence.root 的项目目录中匹配 encodedId
  if (!persistence.root) return null;

  let names = rootDirs;
  if (!names) {
    try {
      const entries = await readdir(persistence.root, { withFileTypes: true });
      names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return null;
    }
  }

  const encodedId = encodeSegment(sessionId);
  for (const name of names) {
    const targetDir = join(persistence.root, name, encodedId);
    try {
      if ((await stat(targetDir)).isDirectory()) return targetDir;
    } catch {
      // 不存在则继续下一个项目目录
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
 * 递归计算目录占用的实际字节大小。
 *
 * 子项之间彼此独立，因此并发处理而非逐个 await —— 会话目录里通常有
 * 多个日志分片，串行 stat 会把延迟线性叠加。
 */
async function getDirSizeBytes(dirPath) {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    // 目录不存在或不可读，按 0 计
    return 0;
  }

  const sizes = await Promise.all(
    entries.map(async (ent) => {
      const full = join(dirPath, ent.name);
      try {
        if (ent.isFile()) return (await stat(full)).size;
        if (ent.isDirectory()) return await getDirSizeBytes(full);
      } catch {
        // 忽略无法访问的子项
      }
      return 0;
    })
  );

  let total = 0;
  for (const size of sizes) total += size;
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

// ==================== 请求级会话度量（带记忆化） ====================
//
// 列表页与删除弹窗都要回答同一个问题：「这个会话在磁盘上占多大」。
// 若不做记忆化，一个会话在列表里会被测量多次（自身 + 每个子代理），而同一个
// 子代理又会被同家族的多个会话各测一遍 —— 目录遍历开销随家族规模平方增长。
// 因此这里把「磁盘路径定位」与「目录体积」都收敛到一次请求内的缓存中。
//
// 另外 `resolveSessionDiskPath` 的回退策略需要先列出 persistence.root 下的
// 全部项目目录；该列表在一次请求内不会变化，同样只取一次。

/**
 * 请求级度量上下文。
 * @param persistence - ctx.sessionPersistence
 */
function createSessionMetrics(persistence) {
  const pathCache = new Map();
  const sizeCache = new Map();
  let rootEntriesPromise = null;

  /** 列出 persistence.root 下的子目录名（只取一次，供路径回退复用） */
  const listRootDirs = () => {
    if (rootEntriesPromise) return rootEntriesPromise;
    rootEntriesPromise = (async () => {
      if (!persistence?.root) return [];
      try {
        const entries = await readdir(persistence.root, { withFileTypes: true });
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        return [];
      }
    })();
    return rootEntriesPromise;
  };

  /** 定位会话磁盘目录（记忆化） */
  const resolvePath = async (sessionId) => {
    if (!sessionId) return null;
    if (pathCache.has(sessionId)) return pathCache.get(sessionId);
    const result = await resolveSessionDiskPath(persistence, sessionId, await listRootDirs());
    pathCache.set(sessionId, result);
    return result;
  };

  /** 测量会话目录体积（记忆化） */
  const measure = async (sessionId) => {
    if (sizeCache.has(sessionId)) return sizeCache.get(sessionId);
    const diskPath = await resolvePath(sessionId);
    const sizeBytes = diskPath ? await getDirSizeBytes(diskPath) : 0;
    const info = { diskPath, sizeBytes };
    sizeCache.set(sessionId, info);
    return info;
  };

  /** 批量测量并汇总为总字节数（有界并发，避免句柄爆炸） */
  const sumSizes = async (sessionIds) => {
    if (sessionIds.length === 0) return 0;
    const sizes = await mapLimit(sessionIds, 8, async (id) => (await measure(id)).sizeBytes);
    return sizes.reduce((total, value) => total + value, 0);
  };

  return { resolvePath, measure, sumSizes };
}

/**
 * 有界并发 map：避免一次请求同时打开过多文件句柄。
 * 结果顺序与输入顺序一致。
 */
async function mapLimit(items, limit, worker) {
  const list = [...items];
  const results = new Array(list.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

// ==================== 血缘索引 ====================
//
// DSH 的会话日志头部同时承载两种血缘关系，二者语义完全不同，必须分开处理：
//
//   1. subagent 边：`origin === 'subagent'` 且带 `parentSession`
//      这是真正由该会话派生的子代理，删除父会话时可选择连带删除。
//      判定与 DSH 官方 `archived-session-gate` 完全一致。
//
//   2. fork 边：带 `parentSession` 但 `origin !== 'subagent'`
//      这是「分支对话」（fork）。fork 是**独立会话**，不是后代，绝不能被连带删除。
//
// 关键事实（已对真实磁盘日志逐帧解码验证）：fork 会把源会话的事件前缀（含
// `subagent/catalog` 事件）复制进自己的日志，但 DSH 官方投影按
// `event.seq < inheritedEventCount` 跳过全部继承事件，因此 **fork 看不到源会话的
// 子代理** —— 这就是「分支后子代理不共享」的成因。
//
// 但子代理自身日志里的 `parentSession` 始终指向真正的派生者（源会话），所以仅凭
// header 沿 fork 链上溯到家族根、再下溯全部 fork 成员，即可完整还原该对话家族
// 实际拥有的全部子代理，无需读取任何日志正文。

/**
 * 建立全量会话血缘索引。
 *
 * 数据来源优先 sessionQuery.listSessions()：它同时覆盖活动会话与磁盘冷会话，
 * 并返回每个会话的持久化 header；服务不可用时退化为内存中的活动会话列表。
 *
 * @returns `{ childrenOf, forksOf, headerById }`
 *   - childrenOf: 父会话 id -> 其直接子代理 id 列表
 *   - forksOf:    会话 id   -> 由它 fork 出的分支会话 id 列表
 *   - headerById: 会话 id   -> 其 header
 */
async function buildSubagentLineage(ctx) {
  const childrenOf = new Map();
  const forksOf = new Map();
  const headerById = new Map();

  const addHeader = (header) => {
    if (!header?.id) return;
    headerById.set(header.id, header);
    if (!header.parentSession) return;

    if (header.origin === 'subagent') {
      const siblings = childrenOf.get(header.parentSession) ?? [];
      siblings.push(header.id);
      childrenOf.set(header.parentSession, siblings);
      return;
    }

    // 带 parentSession 但不是 subagent 来源 => fork 分支会话
    const forks = forksOf.get(header.parentSession) ?? [];
    forks.push(header.id);
    forksOf.set(header.parentSession, forks);
  };

  try {
    const query = ctx.sessionQuery;
    if (typeof query?.listSessions === 'function') {
      const records = await query.listSessions();
      for (const record of records ?? []) addHeader(record?.header);
      return { childrenOf, forksOf, headerById };
    }
  } catch (err) {
    ctx.logger?.debug?.(
      `[dsh-plugin-delete-archived] sessionQuery 血缘索引不可用，退化为内存会话列表: ${String(err)}`
    );
  }

  try {
    for (const session of ctx.sessions?.list?.() ?? []) {
      addHeader(session?.header ?? session?.session?.header);
    }
  } catch {
    // 血缘索引失败时返回空索引，调用方退化为「只删除会话本身」
  }

  return { childrenOf, forksOf, headerById };
}

/** 是否为 fork 分支会话：带 parentSession 但不是 subagent 来源。 */
function isForkSession(header) {
  return Boolean(header?.parentSession) && header.origin !== 'subagent';
}

/**
 * 血缘遍历的记忆化缓存。
 *
 * `collectSubagentDescendants` / `collectForkFamily` 都是血缘索引的**纯函数**，
 * 而列表页会对每个归档会话各调用一次，家族内多个会话的遍历路径高度重叠。
 * 以血缘索引对象为键缓存结果（WeakMap，索引被回收时缓存自动释放），
 * 使整页遍历量从「会话数 × 家族规模」降为「每个会话一次」。
 */
const descendantsCache = new WeakMap();
const forkFamilyCache = new WeakMap();

function memoized(cache, lineage, key, compute) {
  if (!lineage || typeof lineage !== 'object') return compute();
  let byKey = cache.get(lineage);
  if (!byKey) {
    byKey = new Map();
    cache.set(lineage, byKey);
  }
  if (byKey.has(key)) return byKey.get(key);
  const value = compute();
  byKey.set(key, value);
  return value;
}

/**
 * 广度优先收集某会话的全部子代理后代（任意深度）。
 * @returns 每项形如 `{ id, depth }`，depth 从 1 开始；顺序为先父后子。
 */
function collectSubagentDescendants(lineage, rootId) {
  return memoized(descendantsCache, lineage, rootId, () => {
    const out = [];
    if (!lineage?.childrenOf) return out;

    const visited = new Set([rootId]);
    const queue = (lineage.childrenOf.get(rootId) ?? []).map((id) => ({ id, depth: 1 }));

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      out.push({ id, depth });
      for (const child of lineage.childrenOf.get(id) ?? []) queue.push({ id: child, depth: depth + 1 });
    }

    return out;
  });
}

/**
 * 收集某会话所属的完整 fork 家族成员（含自身）。
 *
 * 先沿 fork 边向**上游**走到家族根（遇到非 fork 会话或检测到环时停止），
 * 再从根沿 fork 边向**下游**遍历全部成员。
 *
 * 注意：家族根可能已不在索引中（例如源会话已被删除，只有它的 fork 分支与
 * 子代理还留在磁盘上）。此时仍把该父会话 id 作为家族根保留，因为**它派生的
 * 子代理同样属于这个家族** —— 否则用户删除某个分支时就看不到这些子代理。
 *
 * @returns 家族成员 id 列表，家族根在最前。
 */
function collectForkFamily(lineage, sessionId) {
  return memoized(forkFamilyCache, lineage, sessionId, () => {
    const headerById = lineage?.headerById ?? new Map();
    const forksOf = lineage?.forksOf ?? new Map();

    // 1. 上溯到家族根
    let root = sessionId;
    const climbed = new Set([sessionId]);
    for (;;) {
      const header = headerById.get(root);
      if (!isForkSession(header)) break;
      const parent = header.parentSession;
      if (!parent || climbed.has(parent)) break;
      climbed.add(parent);
      root = parent;
      // 父会话自身已不在索引中：它仍是本分支的家族根，但无法继续上溯
      if (!headerById.has(parent)) break;
    }

    // 2. 从根下溯全部 fork 成员
    const members = [];
    const visited = new Set();
    const queue = [root];
    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      members.push(id);
      for (const fork of forksOf.get(id) ?? []) queue.push(fork);
    }

    return members;
  });
}

/**
 * 汇总一组目标会话实际拥有的子代理，区分两个归属层级。
 *
 * - `own`：由目标会话自身派生的子代理（含任意深度后代）。
 *   删除目标会话时默认建议一并清除。
 * - `shared`：由同一 fork 家族中**其他**对话派生的子代理。
 *   因 fork 不共享子代理，这些子代理在目标会话里看不到，但确实属于同一段
 *   对话的家族。它们默认保留，仅在用户明确选择时才删除。
 *
 * @returns `{ own, shared }`，每项为 `{ id, depth, ownerSessionId }`。
 */
function collectFamilySubagents(lineage, sessionIds) {
  const targets = new Set(sessionIds);
  const own = new Map();
  const shared = new Map();

  // 目标会话自身派生的
  for (const id of targets) {
    for (const { id: childId, depth } of collectSubagentDescendants(lineage, id)) {
      if (!own.has(childId)) own.set(childId, { id: childId, depth, ownerSessionId: id });
    }
  }

  // 同一 fork 家族中其他成员派生的
  const familyMembers = new Set();
  for (const id of targets) {
    for (const member of collectForkFamily(lineage, id)) familyMembers.add(member);
  }
  for (const memberId of familyMembers) {
    if (targets.has(memberId)) continue;
    for (const { id: childId, depth } of collectSubagentDescendants(lineage, memberId)) {
      if (own.has(childId) || shared.has(childId)) continue;
      shared.set(childId, { id: childId, depth, ownerSessionId: memberId });
    }
  }

  return { own: [...own.values()], shared: [...shared.values()] };
}

/**
 * 把目标会话按 **fork 家族**归并成若干簇。
 *
 * 为什么要按家族而不是按会话分：fork 出来的分支（如 A-1）与源对话（A）
 * 属于**同一段对话**，只是被分成了几个分支。删除时若把 A 与 A-1 拆成两组，
 * 用户会以为它们是两段无关的对话；而实际上它们的子代理理应放在一起看、
 * 一起框选。
 *
 * 归并规则：两个目标会话若能通过 fork 边连通（含共同祖先），就归为同一簇。
 * 返回每个簇的**代表会话**（取家族根，便于用源对话的标题做簇标题）与成员列表。
 *
 * @returns `Array<{ rootId, memberIds, familyIds }>`
 */
function groupTargetsByFamily(lineage, sessionIds) {
  // 1. 为每个目标会话求出它所属的家族根
  const familyRootOf = new Map();
  for (const id of sessionIds) {
    // collectForkFamily 的第一个元素就是家族根
    const family = collectForkFamily(lineage, id);
    familyRootOf.set(id, family.length > 0 ? family[0] : id);
  }

  // 2. 按家族根归并目标会话
  const byRoot = new Map();
  for (const id of sessionIds) {
    const root = familyRootOf.get(id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(id);
  }

  // 3. 收集每个簇的完整家族成员（含未在目标里的分支），供 shared 判定复用
  return [...byRoot.entries()].map(([rootId, memberIds]) => ({
    rootId,
    memberIds,
    familyIds: collectForkFamily(lineage, rootId),
  }));
}

/**
 * 会话标题读取器（带记忆化）。
 * 弹窗里同一个派生者标题会被组标题与每个条目各读一次，列表页也会重复读，
 * 因此统一收敛为一次请求内每个 id 至多读一次。
 *
 * **三级取标题，前一级拿不到才降级：**
 *
 *   1. `ctx.sessionQuery.readTitle()` —— 活动会话最快，但**归档会话读不到**；
 *   2. 会话日志里的 `session/title` 事件 —— 归档会话的**唯一可靠来源**。
 *      实测 392 个 projcache 条目里 39/40 都有标题，而 readTitle 拿到的全是空，
 *      于是界面只剩目录名 `session-xxxxxxxx` —— 用户看到的就是这个；
 *   3. 日志里首条真实用户输入（`user/message`）—— 会话还没生成标题时用它。
 *
 * **任何一级都读不到时返回 `null`，绝不回落成完整 id。**
 * 曾经的实现是 `let title = id`，于是读不到标题的会话会把
 * `session-26c55335-fbf8-4e6a-a398-e8dd3f5a1e42` 这种 44 字符整串塞进界面：
 *   - 组标题被省略号截成 `session-26c55335-fbf8-4e…`，完全看不出是哪个会话；
 *   - 更糟的是前端写的是 `familyTitle || shortId(...)`，而完整 id 是 truthy，
 *     直接**短路**了 shortId 回落 —— 想靠前端兜底也兜不住。
 *
 * @param ctx
 * @param readExcerpt - 日志读取器（由 createExcerptReader 提供），用于第 2、3 级
 */
function createTitleReader(ctx, readExcerpt) {
  const cache = new Map();
  const query = ctx.sessionQuery;
  return async (id) => {
    if (cache.has(id)) return cache.get(id);
    let title = null;

    // 第 1 级：活动会话查询接口
    if (typeof query?.readTitle === 'function') {
      try {
        const snapshot = await query.readTitle(id);
        if (snapshot?.title) title = snapshot.title;
      } catch {
        // 读不到标题不算错误，继续降级
      }
    }

    // 第 2、3 级：从会话日志读（归档会话只能靠这里）
    if (!title && typeof readExcerpt === 'function') {
      try {
        const { logTitle, excerpt } = await readExcerpt(id);
        title = logTitle || excerpt || null;
      } catch {
        // 日志不可读时同样交给调用方兜底
      }
    }

    // 少数情况下上游会把 id 本身当标题返回，这同样不算有效标题
    if (title === id) title = null;
    cache.set(id, title);
    return title;
  };
}

// ==================== 会话日志摘录 ====================
//
// 为什么需要它（已对真实日志逐帧解码验证）：
//
//   DSH 写入的 `session/title` 事件可能是**自动降级**结果：
//
//     {"type":"session/title","data":{"title":"你是一个测试子代理。请只回",
//                                     "source":{"kind":"fallback"}}}
//
//   `source.kind = "fallback"` 表示标题是 DSH 自己凑出来的，并在半句话处硬截断。
//   后果有两个，都会直接伤害删除确认弹窗的可用性：
//     1. 文本停在不该停的地方，看起来像「被截断却没打省略号」；
//     2. 同一批子代理的标题**完全相同**（实测 6 个子代理共用同一标题），无法分辨。
//
//   但日志里同时保留了更可靠的信息：
//     - `subagent/descriptor` 的 `label`（如「子代理四」）—— 有辨识度的短名；
//     - 首条 `user/message` 的完整文本 —— 比降级标题更长、更完整。
//
// 成本：子代理日志实测最大 563 KB（主会话才有 4 MB 量级），整份读取可接受。
// 仍设上限，并在拿齐两个字段后立即停止解析。

/** zstd 帧魔数：DSH 日志是**多帧** zstd，单次解压只能得到第一帧 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** 单个日志的读取上限，超出则放弃摘录（退回 DSH 标题），避免拖慢弹窗 */
const EXCERPT_MAX_BYTES = 2 * 1024 * 1024;

/** 摘要字符上限：界面只用于一行标题，过长没有意义 */
const EXCERPT_MAX_CHARS = 160;

/** 系统自动注入的前缀，不是用户真正输入的内容 */
const BOILERPLATE_PREFIXES = ['<system-reminder>', 'Current runtime context', '<available_skills>'];

function isBoilerplateText(text) {
  return BOILERPLATE_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** 从任意嵌套结构里深度优先取第一个非空 `text` 字段 */
function firstTextField(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (typeof node.text === 'string' && node.text.trim()) return node.text;
  for (const value of Object.values(node)) {
    const found = firstTextField(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 摘要读取器（带记忆化）。
 * @returns `{ label, excerpt }`；两者都可能为 null（此时调用方退回 DSH 标题）
 */
function createExcerptReader(metrics) {
  const cache = new Map();

  /** 按魔数切分多帧 zstd 并逐帧解压 */
  const decompressFrames = (buf) => {
    const starts = [];
    let cursor = 0;
    while (cursor < buf.length) {
      const at = buf.indexOf(ZSTD_MAGIC, cursor);
      if (at < 0) break;
      starts.push(at);
      cursor = at + 4;
    }

    let text = '';
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : buf.length;
      try {
        text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString('utf8');
      } catch {
        // 末帧可能因读取上限而不完整，跳过即可
      }
    }
    return text;
  };

  /** 从日志行里挑出 label、标题与首条真实用户输入 */
  const extract = (text) => {
    const result = { label: null, excerpt: null, logTitle: null };

    for (const line of text.split('\n')) {
      // 廉价预筛：避免 JSON.parse 那些体积巨大的 request/header 行
      if (line.charCodeAt(0) !== 123 /* '{' */) continue;
      const hasLabel = line.includes('"subagent/descriptor"');
      const hasUser = line.includes('"user/message"');
      const hasTitle = line.includes('"session/title"');
      if (!hasLabel && !hasUser && !hasTitle) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (!result.label && event.type === 'subagent/descriptor') {
        const label = event.data?.label;
        if (typeof label === 'string' && label.trim()) result.label = label.trim();
      }

      /**
       * 会话标题以日志里的 `session/title` 为准。
       *
       * 这是**唯一可靠的标题来源**：`ctx.sessionQuery.readTitle()` 只对活动会话
       * 有效，归档会话读不到（实测 392 个 projcache 条目里 39/40 有标题，
       * 但界面拿到的全是空）。读不到就只能显示目录名（session-xxxxxxxx），
       * 而用户要的是标题。
       *
       * 同一份日志里 title 事件可能被多次写入（改标题、降级），取**最后一条**——
       * 那是最新状态。
       */
      if (hasTitle && event.type === 'session/title') {
        const t = event.data?.title;
        if (typeof t === 'string' && t.trim()) result.logTitle = t.trim();
      }

      if (!result.excerpt && event.type === 'user/message') {
        const found = firstTextField(event.data);
        if (found && !isBoilerplateText(found)) result.excerpt = found.trim();
      }

      // 三个都拿到才提前结束。
      //
      // 这里曾经写成「有 label + excerpt 就 break」——那是错的：
      // `session/title` 事件通常排在首条 `user/message` **之后**（实测 seq 9 → seq 16），
      // 提前跳出会永远读不到标题，日志里明明有、界面却只能显示目录名。
      if (result.label && result.excerpt && result.logTitle) break;
    }

    // 摘要用于替换降级标题，过长就截断，避免界面里出现整段正文
    if (result.excerpt && result.excerpt.length > EXCERPT_MAX_CHARS) {
      result.excerpt = result.excerpt.slice(0, EXCERPT_MAX_CHARS);
    }

    return result;
  };

  const readOne = async (sessionId) => {
    const empty = { label: null, excerpt: null, logTitle: null };

    const diskPath = await metrics.resolvePath(sessionId);
    if (!diskPath) return empty;

    let names;
    try {
      names = await readdir(diskPath);
    } catch {
      return empty;
    }

    const logName =
      names.find((n) => n.startsWith('session.') && n.endsWith('.jsonl.zstd')) ??
      names.find((n) => n.endsWith('.zstd'));
    if (!logName) return empty;

    const fullPath = join(diskPath, logName);
    try {
      const info = await stat(fullPath);
      if (!info.isFile() || info.size === 0 || info.size > EXCERPT_MAX_BYTES) return empty;
      return extract(decompressFrames(await readFile(fullPath)));
    } catch {
      return empty;
    }
  };

  return async (sessionId) => {
    if (!sessionId) return { label: null, excerpt: null, logTitle: null };
    if (cache.has(sessionId)) return cache.get(sessionId);
    const result = await readOne(sessionId);
    cache.set(sessionId, result);
    return result;
  };
}

/**
 * 汇总若干会话的子代理明细，供前端删除确认弹窗展示。
 * 只读操作：不修改任何状态，也不删除任何文件。
 */
async function getSubagentDescendantsInfo(ctx, sessionIds) {
  const lineage = await buildSubagentLineage(ctx);
  const { own, shared } = collectFamilySubagents(lineage, sessionIds);
  const metrics = createSessionMetrics(ctx.sessionPersistence);
  // 注意顺序：标题读取器要用日志读取器做降级，必须先建 readExcerpt
  const readExcerpt = createExcerptReader(metrics);
  const readTitle = createTitleReader(ctx, readExcerpt);

  const describe = async (entry) => {
    const { diskPath, sizeBytes } = await metrics.measure(entry.id);
    const createdAt = lineage.headerById.get(entry.id)?.createdAt;
    const title = await readTitle(entry.id);
    const { label, excerpt } = await readExcerpt(entry.id);

    /**
     * 展示用标题的挑选顺序：
     *   1. `label`（descriptor 名，如「子代理四」）—— 最短、最有辨识度，
     *      同一批子代理的 label 互不相同，是分辨彼此的最佳依据；
     *   2. 降级标题（DSH 凑出来的）比摘要短时，用**摘要**替代 ——
     *      因为降级标题会停在半句话上，看着像 bug；
     *   3. 都没有才退回 DSH 标题。
     *
     * `fallbackTitle` 保留原始降级标题，供界面提示「这个标题是自动生成的」。
     */
    const isFallbackTitle = excerpt !== null && title !== null && excerpt.startsWith(title);
    let displayTitle = title;
    if (isFallbackTitle) displayTitle = excerpt;

    return {
      id: entry.id,
      title: displayTitle,
      fallbackTitle: isFallbackTitle ? title : null,
      label,
      depth: entry.depth,
      ownerSessionId: entry.ownerSessionId,
      diskPath: diskPath || null,
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    };
  };

  const ownItems = await mapLimit(own, 8, describe);
  const sharedItems = await mapLimit(shared, 8, describe);

  const sum = (items) => items.reduce((total, item) => total + (item.sizeBytes || 0), 0);

  /**
   * 取标题，读不到时用**日志里的首条用户输入**兜底。
   *
   * 为什么需要兜底：`sessionQuery.readTitle` 对部分归档会话读不到标题
   * （实测 `session-26c55335-…` 在 projcache 里有标题，但界面拿到的是空），
   * 若直接显示 id，用户看到的就是一串看不出是哪个会话的字符。
   * 日志摘要此时是最好的替代 —— DSH 生成标题用的本来就是这条首条输入
   * （projcache 的 `titleInput.first.text`），所以两者语义一致。
   *
   * 同理，DSH 的自动标题会被**硬截断在半句**上
   * （实测 `你是一个测试子代理。请只回`）。当标题恰好是完整摘要的前缀时，
   * 说明它就是那条被截断的降级标题 —— 用摘要替换，否则界面停在不该停的地方。
   */
  const titleWithFallback = async (id) => {
    const title = await readTitle(id);
    const { excerpt } = await readExcerpt(id);
    if (title && excerpt && excerpt.startsWith(title)) return excerpt;
    if (title) return title;
    return excerpt || null;
  };

  // 按 **fork 家族**分组，而不是按单个会话分组。
  //
  // 理由：A 与它的分支 A-1 属于同一段对话，只是被分成了几个分支。
  // 若拆成两组，用户会误以为它们是两段无关的对话；实际上一段对话衍生的
  // 子代理理应放在一起看、一起框选。B 属于另一个家族，才单独成组。
  const familyClusters = groupTargetsByFamily(lineage, sessionIds);
  const groups = await mapLimit(familyClusters, 8, async (cluster) => {
    const memberSet = new Set(cluster.memberIds);
    return {
      // 家族根 id 作为稳定键
      familyRootId: cluster.rootId,
      // 簇标题取家族根的标题（通常就是源对话 A），最能代表这一整段对话
      familyTitle: await titleWithFallback(cluster.rootId),
      // 这个簇里本次要删的会话（用于界面标注「含 N 个分支」）
      memberIds: cluster.memberIds,
      memberTitles: await mapLimit(cluster.memberIds, 8, (id) => titleWithFallback(id)),
      // 该家族派生的子代理（本次目标会话派生的）
      subagents: ownItems.filter((item) => memberSet.has(item.ownerSessionId)),
      subagentCount: ownItems.filter((item) => memberSet.has(item.ownerSessionId)).length,
    };
  });

  // 空簇（本次没有任何子代理）不展示
  const nonEmptyGroups = groups.filter((g) => g.subagents.length > 0);

  /**
   * shared 按真正的派生者（owner）分组，并给出足够辨识的信息：
   * - `relation`：'source' 表示派生者是本会话的**源对话**，
   *               'sibling' 表示是同一家族中的**兄弟分支**；
   * - `ownerTitle` / `ownerCreatedAt`：用于在界面上标注「这些子代理来自哪一段对话」；
   * - `familyRootId`：这些派生者所属的**家族根**。
   *   界面要按家族把「本会话 + 源对话 + 兄弟分支」圈成**一个整体**，
   *   因此每个 shared 组都必须能回答「我属于哪个家族」，否则无法归位。
   */
  const familyRootIds = new Set(familyClusters.map((c) => c.rootId));

  /** 求出某个 owner 所属家族中、**在本次目标里**的那个家族根（找不到则返回自身） */
  const ownerFamilyRoot = (ownerSessionId) => {
    for (const member of collectForkFamily(lineage, ownerSessionId)) {
      if (familyRootIds.has(member)) return member;
    }
    // owner 自己就是家族根，或在目标里找不到对应家族（孤立情形）
    return ownerSessionId;
  };

  const ownerIds = [...new Set(sharedItems.map((item) => item.ownerSessionId))];
  const sharedGroups = await Promise.all(
    ownerIds.map(async (ownerSessionId) => {
      // 只有「本会话的直接父」才算源对话；更远的祖先一律按兄弟分支呈现，
      // 避免嵌套 fork 时把祖父也标成「源对话」而误导用户。
      let relation = 'sibling';
      for (const id of sessionIds) {
        const header = lineage.headerById.get(id);
        if (isForkSession(header) && header.parentSession === ownerSessionId) {
          relation = 'source';
          break;
        }
      }
      const ownerCreatedAt = lineage.headerById.get(ownerSessionId)?.createdAt;
      return {
        ownerSessionId,
        ownerTitle: await titleWithFallback(ownerSessionId),
        ownerCreatedAt: ownerCreatedAt ? new Date(ownerCreatedAt).toISOString() : null,
        // 归属到哪个家族块，界面据此把同族各组圈在一起
        familyRootId: ownerFamilyRoot(ownerSessionId),
        relation,
        subagents: sharedItems.filter((item) => item.ownerSessionId === ownerSessionId),
      };
    })
  );

  return {
    // 本会话派生的子代理（按 fork 家族聚合）
    totalSubagents: ownItems.length,
    totalSizeBytes: sum(ownItems),
    totalSizeFormatted: formatBytes(sum(ownItems)),
    groups: nonEmptyGroups,
    // 同家族其他对话派生的子代理（fork 不共享，需显式列出）
    totalSharedSubagents: sharedItems.length,
    totalSharedSizeBytes: sum(sharedItems),
    totalSharedSizeFormatted: formatBytes(sum(sharedItems)),
    sharedGroups,
  };
}

// ==================== 删除 ====================

/**
 * 递归删除一组子代理会话（由深到浅，避免留下孤立的孙代理）。
 * @returns 实际删除成功的子代理 id 列表
 */
async function deleteSubagentSet(ctx, entries, errors) {
  const deleted = [];
  const ordered = [...entries].sort((a, b) => b.depth - a.depth);
  for (const entry of ordered) {
    try {
      await deleteArchivedSession(ctx, entry.id, { includeSubagents: false });
      deleted.push(entry.id);
    } catch (err) {
      ctx.logger?.warn?.(`删除子代理会话 ${entry.id} 失败: ${String(err)}`);
      errors?.push({ id: entry.id, error: String(err?.message || err) });
    }
  }
  return deleted;
}

/**
 * 核心删除操作：永久安全删除一个会话（包含归档与活动状态会话）
 *
 * 子代理的选择有两种表达方式，`explicitSubagentIds` 优先：
 *
 * - **精确选择**（推荐，界面使用）：`explicitSubagentIds` 给出确切要删除的
 *   子代理 id 集合，允许用户只删其中一部分。
 * - **按归属选择**（Agent 工具使用）：`includeSubagents` 删除本会话自身派生的，
 *   `includeSharedSubagents` 删除同一 fork 家族其他对话派生的。
 *
 * @param options.explicitSubagentIds - 确切要删除的子代理 id 列表；给出时忽略上面两个开关
 * @param options.lineage - 已构建的血缘索引，批量删除时复用，避免重复全量扫描
 * @returns `{ success, sessionId, deletedSubagents }`
 */
async function deleteArchivedSession(ctx, sessionId, options = {}) {
  const workspaceRegistry = ctx.workspaceRegistry;
  if (!workspaceRegistry) {
    throw new Error('workspaceRegistry service not available');
  }

  const logger = ctx.logger;
  const errors = [];
  let deletedSubagents = [];

  // 0. 可选：先删除子代理后代（由深到浅，避免留下孤立的孙代理）
  const explicit = Array.isArray(options.explicitSubagentIds) ? options.explicitSubagentIds : null;
  const needLineage =
    explicit !== null || options.includeSubagents === true || options.includeSharedSubagents === true;

  if (needLineage) {
    const lineage = options.lineage ?? (await buildSubagentLineage(ctx));
    // 归属只解析一次，两个分支共用（原先各算一遍，纯属重复遍历）
    const { own, shared } = collectFamilySubagents(lineage, [sessionId]);

    let targets;
    if (explicit !== null) {
      // 精确模式：只删用户勾选的那些，深度取自血缘索引
      const byId = new Map([...own, ...shared].map((entry) => [entry.id, entry]));
      targets = explicit
        .map((id) => byId.get(id) ?? { id, depth: 0 })
        .filter((entry) => entry.id !== sessionId);
    } else {
      targets = [
        ...(options.includeSubagents === true ? own : []),
        ...(options.includeSharedSubagents === true ? shared : []),
      ];
    }
    deletedSubagents = await deleteSubagentSet(ctx, targets, errors);
  }

  const archivedIds = workspaceRegistry.archivedSessionIds || [];
  const isArchived = archivedIds.includes(sessionId);

  // 1. 停止该会话相关的运行与调度
  try {
    await ctx.parallel('workspace/session-stop', { sessionId });
  } catch (err) {
    logger?.warn?.(`停止会话 ${sessionId} 失败: ${String(err)}`);
  }

  // 2. 注销内存中的会话实例。
  //    若该会话仍是活动会话，调用其官方 detach 会触发真正的 session/disposed，
  //    由 ApiSession 服务转发 api-session/removed 给客户端；否则需要手动补发该广播。
  let disposedLive = false;
  try {
    const sessions = ctx.sessions;
    if (sessions?.store?.get?.(sessionId)) {
      const entry = sessions.store.get(sessionId);
      if (entry && typeof entry.detach === 'function') {
        entry.detach();
        disposedLive = true;
      }
    }
  } catch (err) {
    logger?.debug?.(`注销内存会话 ${sessionId} 失败: ${String(err)}`);
  }

  // 通知客户端把该会话从侧边栏列表中彻底移除
  if (!disposedLive) {
    try {
      ctx.emit?.('api-session/removed', sessionId);
    } catch (err) {
      logger?.debug?.(`发送会话移除广播 ${sessionId} 失败: ${String(err)}`);
    }
  }

  // 3. 从各个工作区实体的 sessionIds 中解绑 (必须在解除归档之前执行，确保会话从所有工作区彻底剔除)
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

  // 4. 若该会话处于已归档状态，从工作区持久状态的已归档集合中剔除
  if (isArchived) {
    try {
      if (typeof workspaceRegistry.unarchiveSession === 'function') {
        await workspaceRegistry.unarchiveSession(sessionId);
      }
    } catch (err) {
      logger?.warn?.(`从已归档集合中解绑会话 ${sessionId} 失败: ${String(err)}`);
    }
  }

  // 5. 清理 persistence 句柄与缓存
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

  // 6. 物理删除磁盘日志文件及整个会话文件夹
  try {
    const persistence = ctx.sessionPersistence;
    await removeSessionDiskArtifacts(persistence, sessionId);
  } catch (err) {
    logger?.warn?.(`删除会话 ${sessionId} 磁盘文件失败: ${String(err)}`);
  }

  return { success: true, sessionId, deletedSubagents, errors };
}

/**
 * 批量执行归档会话删除
 *
 * 血缘只解析一次；目标会话本身先全部删除，再统一清理子代理，
 * 避免逐个会话重复全量扫描。
 *
 * 与单会话删除一致，`explicitSubagentIds` 优先于两个归属开关。
 *
 * @param options.explicitSubagentIds - 确切要删除的子代理 id 列表
 * @param options.includeSubagents - 连同各会话自身派生的子代理一并删除
 * @param options.includeSharedSubagents - 连同同一 fork 家族其他对话派生的子代理一并删除
 */
async function deleteArchivedSessionsBatch(ctx, targetIds, options = {}) {
  const includeSubagents = options.includeSubagents === true;
  const includeSharedSubagents = options.includeSharedSubagents === true;
  const explicit = Array.isArray(options.explicitSubagentIds) ? options.explicitSubagentIds : null;
  const needLineage = explicit !== null || includeSubagents || includeSharedSubagents;
  const lineage = needLineage ? await buildSubagentLineage(ctx) : null;

  let own = [];
  let shared = [];
  if (lineage) {
    const collected = collectFamilySubagents(lineage, targetIds);
    own = collected.own;
    shared = collected.shared;
  }

  let deletedCount = 0;
  const errors = [];

  for (const id of targetIds) {
    try {
      await deleteArchivedSession(ctx, id, { includeSubagents: false });
      deletedCount++;
    } catch (err) {
      errors.push({ id, error: String(err?.message || err) });
    }
  }

  // 精确模式下只删用户勾选的；否则按归属开关汇总
  let targets;
  if (explicit !== null) {
    const byId = new Map([...own, ...shared].map((entry) => [entry.id, entry]));
    const targetSet = new Set(targetIds);
    targets = explicit
      .filter((id) => !targetSet.has(id))
      .map((id) => byId.get(id) ?? { id, depth: 0 });
  } else {
    targets = [...(includeSubagents ? own : []), ...(includeSharedSubagents ? shared : [])];
  }
  const deletedSubagents = await deleteSubagentSet(ctx, targets, errors);

  return {
    success: true,
    deletedCount,
    deletedSubagentCount: deletedSubagents.length,
    // 与单会话删除保持一致，便于调用方核对究竟删了哪些子代理
    deletedSubagents,
    total: targetIds.length,
    errors,
  };
}

/**
 * 并行获取所有已归档会话的完整信息列表
 */
async function getArchivedSessionsInfo(ctx) {
  const workspaceRegistry = ctx.workspaceRegistry;
  if (!workspaceRegistry) return [];

  const archivedIds = workspaceRegistry.archivedSessionIds || [];
  if (archivedIds.length === 0) return [];

  // 血缘索引只构建一次，避免每个会话重复全量扫描
  const lineage = await buildSubagentLineage(ctx);
  // 度量与标题都做请求级记忆化：同一子代理不再被家族内多个会话重复测量
  const metrics = createSessionMetrics(ctx.sessionPersistence);
  const readExcerpt = createExcerptReader(metrics);
  const readTitle = createTitleReader(ctx, readExcerpt);

  /**
   * 取标题，读不到时用日志首条用户输入兜底。
   * 理由同 getSubagentDescendantsInfo：绝不让完整 id 出现在界面上。
   *
   * 另有一层处理：DSH 会把自动生成的标题**硬截断在半句**上
   * （实测 `你是一个测试子代理。请只回`），而日志里的首条用户输入是完整的
   * （`你是一个测试子代理。请只回复文本：子代理4已完成。`）。
   * 当标题恰好是摘要的前缀时，说明它就是那条被截断的降级标题 —— 用完整摘要替换，
   * 否则界面会停在不该停的地方，看起来像 bug。
   */
  const titleWithFallback = async (id) => {
    const title = await readTitle(id);
    const { excerpt } = await readExcerpt(id);
    if (title && excerpt && excerpt.startsWith(title)) return excerpt;
    if (title) return title;
    return excerpt || null;
  };

  // 建立工作区路径到标题的映射缓存
  const workspaceTitleMap = new Map();
  if (workspaceRegistry.entities) {
    for (const entity of workspaceRegistry.entities.values()) {
      if (entity?.path) {
        workspaceTitleMap.set(entity.path, entity.title || entity.path);
      }
    }
  }

  // 先算出每个会话的子代理归属，再统一测量，便于复用同一份体积缓存
  const plans = archivedIds.map((id) => {
    const { own, shared } = collectFamilySubagents(lineage, [id]);
    return { id, own, shared };
  });

  const results = await mapLimit(plans, 8, async ({ id, own, shared }) => {
    const header = workspaceRegistry.headers?.get(id) ?? lineage.headerById.get(id);
    const cwd = header?.cwd;
    const createdAt = header?.createdAt;

    const title = await titleWithFallback(id);
    const workspaceTitle = (cwd && workspaceTitleMap.get(cwd)) || '未分组';

    const self = await metrics.measure(id);
    const subagentSizeBytes = await metrics.sumSizes(own.map((entry) => entry.id));
    const sharedSubagentSizeBytes = await metrics.sumSizes(shared.map((entry) => entry.id));

    return {
      id,
      title,
      cwd,
      workspaceTitle,
      diskPath: self.diskPath || '未定位到独立物理目录',
      sizeBytes: self.sizeBytes,
      sizeFormatted: formatBytes(self.sizeBytes),
      subagentCount: own.length,
      subagentSizeBytes,
      subagentSizeFormatted: formatBytes(subagentSizeBytes),
      sharedSubagentCount: shared.length,
      sharedSubagentSizeBytes,
      sharedSubagentSizeFormatted: formatBytes(sharedSubagentSizeBytes),
      createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    };
  });

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
  ctx.logger?.info?.('[dsh-plugin-delete-archived] Plugin activated');

  const webServer = ctx.webServer;
  const workspaceRegistry = ctx.workspaceRegistry;
  const tools = ctx.tools;

  if (webServer) {
    const registerRoute = (method, path, handler, label) => {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (req.method !== method) return sendError(res, 'Method Not Allowed', 405);
          try {
            await handler(req, res);
          } catch (e) {
            sendError(res, e.message || e, 500);
          }
        },
      }), `archived-sessions: ${method} ${path}`);
    };

    // 1. 获取所有已归档会话
    registerRoute('GET', '/api/archived-sessions', async (_req, res) => {
      const list = await getArchivedSessionsInfo(ctx);
      sendJson(res, { sessions: list });
    });

    // 2. 删除单个已归档会话（可精确指定要一并删除的子代理）
    registerRoute('POST', '/api/archived-sessions/delete', async (req, res) => {
      const { sessionId, subagentIds, includeSubagents, includeSharedSubagents } = await readJsonBody(req);
      if (!sessionId) return sendError(res, 'sessionId is required', 400);
      const result = await deleteArchivedSession(ctx, sessionId, {
        explicitSubagentIds: Array.isArray(subagentIds) ? subagentIds : null,
        includeSubagents: includeSubagents === true,
        includeSharedSubagents: includeSharedSubagents === true,
      });
      sendJson(res, result);
    });

    // 3. 批量/全部删除已归档会话（可精确指定要一并删除的子代理）
    registerRoute('POST', '/api/archived-sessions/delete-batch', async (req, res) => {
      const body = await readJsonBody(req);
      const targetIds = Array.isArray(body.sessionIds)
        ? body.sessionIds
        : [...(workspaceRegistry?.archivedSessionIds || [])];
      const result = await deleteArchivedSessionsBatch(ctx, targetIds, {
        explicitSubagentIds: Array.isArray(body.subagentIds) ? body.subagentIds : null,
        includeSubagents: body.includeSubagents === true,
        includeSharedSubagents: body.includeSharedSubagents === true,
      });
      sendJson(res, result);
    });

    // 4. 预览会话的子代理（删除确认弹窗使用，只读）
    registerRoute('POST', '/api/archived-sessions/descendants', async (req, res) => {
      const body = await readJsonBody(req);
      const targetIds = Array.isArray(body.sessionIds) && body.sessionIds.length > 0
        ? body.sessionIds
        : [...(workspaceRegistry?.archivedSessionIds || [])];
      const info = await getSubagentDescendantsInfo(ctx, targetIds);
      sendJson(res, info);
    });

    // 5. 恢复单个已归档会话
    registerRoute('POST', '/api/archived-sessions/restore', async (req, res) => {
      const { sessionId } = await readJsonBody(req);
      if (!sessionId) return sendError(res, 'sessionId is required', 400);
      await workspaceRegistry.unarchiveSession(sessionId);
      sendJson(res, { success: true, sessionId });
    });

    // 6. 批量恢复已归档会话
    registerRoute('POST', '/api/archived-sessions/restore-batch', async (req, res) => {
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
    });

    // 7. 跨平台在系统资源管理器中打开物理文件夹
    registerRoute('POST', '/api/archived-sessions/open-folder', async (req, res) => {
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
    });
  }

  // 注册 Agent Tool (供对话中调用)
  if (tools) {
    ctx.effect(() => tools.register({
      name: 'delete_archived_sessions',
      description: '彻底删除已归档会话及磁盘日志。不传 session_id 即删除全部已归档会话；未归档会话不受影响。',
      parameters: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: '可选：要删除的已归档会话 ID。',
          },
          include_subagents: {
            type: 'boolean',
            description: '可选：连带删除该会话自身派生的子代理。默认 false。',
          },
          include_shared_subagents: {
            type: 'boolean',
            description: '可选：连带删除同家族其他对话派生的子代理。默认 false。',
          },
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute({ session_id, include_subagents, include_shared_subagents }) {
        const includeSubagents = include_subagents === true;
        const includeSharedSubagents = include_shared_subagents === true;
        const suffix = (count) => (count > 0 ? `，并连带删除了 ${count} 个子代理会话` : '');

        if (session_id) {
          try {
            const result = await deleteArchivedSession(ctx, session_id, {
              includeSubagents,
              includeSharedSubagents,
            });
            return `已成功彻底删除已归档会话：${session_id}${suffix(result.deletedSubagents?.length ?? 0)}`;
          } catch (e) {
            return `删除会话 ${session_id} 失败: ${e.message || String(e)}`;
          }
        }

        const allArchived = [...(workspaceRegistry?.archivedSessionIds || [])];
        if (allArchived.length === 0) {
          return '当前没有已归档的会话。';
        }

        const result = await deleteArchivedSessionsBatch(ctx, allArchived, {
          includeSubagents,
          includeSharedSubagents,
        });
        let msg = `已彻底删除 ${result.deletedCount}/${result.total} 个已归档会话。`;
        if (result.deletedSubagentCount > 0) {
          msg += `\n连同删除了 ${result.deletedSubagentCount} 个子代理会话。`;
        }
        if (result.errors.length > 0) {
          msg += `\n失败项：\n` + result.errors.map((e) => `${e.id}: ${e.error}`).join('\n');
        }
        return msg;
      },
    }), 'tool: delete_archived_sessions');
  }
}
