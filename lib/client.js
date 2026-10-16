window.__ModuleLoader__.load({
  id: 'dsh-plugin-delete-archived',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, useSyncExternalStore, createElement: h, Fragment } = React;

    /**
     * 官方 UI 原子库。按 DSH 客户端模块规范，Module Loader 形式的插件通过 loader 的
     * `require` 解析它（隐式 baseline external），不得打包另一份副本，也不列为运行时依赖。
     * 取不到时全部退化为本插件自带的自包含实现，插件依旧可用。
     */
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives') ?? null;
      } catch {
        return null;
      }
    })();
    const PButton = primitives?.Button ?? null;
    const PModal = primitives?.Modal ?? null;
    const PCheckbox = primitives?.Checkbox ?? null;
    const PTag = primitives?.Tag ?? null;
    const PIconWarning = primitives?.IconWarningOutlineRegular ?? null;
    // 折叠与分支图标一律用官方图标；尺寸交给 CSS 覆盖 svg 的 width/height
    // （官方 DisclosureRow 也是这个做法），因此不依赖组件自身的 size prop。
    const PIconChevron = primitives?.IconChevronDownOutlineRegular ?? null;
    const PIconBranch = primitives?.IconBranchOutlineRegular ?? null;
    const PIconFolder = primitives?.IconFolderOpenOutlineRegular ?? null;

    // ==================== 国际化资源字典 ====================
    const LOCALES = {
      zh: {
        // 设置页
        menuItem: '彻底删除会话',
        title: '已归档会话',
        desc: '彻底删除已归档会话及磁盘日志，不可撤销。',
        refresh: '刷新',
        deleteSelected: '删除 ({count})',
        restoreSelected: '恢复',
        totalCount: '共 {count} 个',
        loading: '加载中...',
        empty: '没有已归档的会话。',
        colTitle: '会话 / 目录',
        colSubagent: '子代理',
        colWorkspace: '工作区',
        colDate: '归档时间',
        openFolder: '在文件管理器中打开',
        badgeOwnHint: '本会话派生 {count} 个（删除时默认勾选）',
        badgeSharedHint: '同家族其他对话派生 {count} 个（默认保留）',
        unassigned: '未分组',
        restoreBatchSuccess: '已恢复 {count} 个会话',
        deleteBatchSuccess: '已删除 {count} 个会话',
        deleteBatchSuccessWithSub: '已删除 {count} 个会话，并连同删除了 {sub} 个子代理',
        requestError: '出错: {error}',
        navLabel: '已归档会话',

        // 删除确认弹窗：只保留最有用的一句（不可恢复）
        confirmTitle: '彻底删除会话',
        confirmTitleBatch: '彻底删除 {count} 个会话',
        confirmDesc: '此操作不可恢复。',
        confirmDescNamed: '将彻底删除会话「{title}」，此操作不可恢复。',
        confirmDescBatch: '将彻底删除所选的 {count} 个会话，此操作不可恢复。',
        cancel: '取消',
        confirmAction: '删除',
        deleting: '删除中...',
        confirmChecking: '检查子代理...',

        // 子代理选择器
        subagentTitle: '一并删除的子代理',
        targetsLabel: '涉及会话',
        selectAllAll: '全选全部',
        selectAllHint: '选中所有家族的子代理',
        selectNoneHint: '清空所有选择',
        selectNone: '全不选',
        groupSelf: '本会话派生',
        relFamilyBranches: '含 {count} 个分支',
        relSource: '源对话',
        relSibling: '兄弟分支',
        groupCountHint: '{count} 个子代理',
        toggleBlockHint: '全选/全不选这一段对话：{title}',
        blockCountHint: '{count} 个子代理',
        blockSelected: '已选 {selected}/{total}',
        toggleGroupHint: '全选/全不选：{title}',
        selectedSummary: '已选 {count} 个 · {size}',
        depthLabel: '第 {depth} 层',
      },
      en: {
        menuItem: 'Delete Permanently',
        title: 'Archived Sessions',
        desc: 'Permanently delete archived sessions and their disk logs. This cannot be undone.',
        refresh: 'Refresh',
        deleteSelected: 'Delete ({count})',
        restoreSelected: 'Restore',
        totalCount: '{count} total',
        loading: 'Loading...',
        empty: 'No archived sessions.',
        colTitle: 'Session / Directory',
        colSubagent: 'Subagents',
        colWorkspace: 'Workspace',
        colDate: 'Archived At',
        openFolder: 'Reveal in file manager',
        badgeOwnHint: 'Derived by this session: {count} (selected by default on delete)',
        badgeSharedHint: 'Derived by other conversations in the same family: {count} (kept by default)',
        unassigned: 'Unassigned',
        restoreBatchSuccess: 'Restored {count} session(s)',
        deleteBatchSuccess: 'Deleted {count} session(s)',
        deleteBatchSuccessWithSub: 'Deleted {count} session(s) and {sub} subagent(s)',
        requestError: 'Error: {error}',
        navLabel: 'Archived',

        confirmTitle: 'Delete Session Permanently',
        confirmTitleBatch: 'Delete {count} Sessions Permanently',
        confirmDesc: 'This cannot be undone.',
        confirmDescNamed: 'This permanently deletes "{title}". It cannot be undone.',
        confirmDescBatch: 'This permanently deletes the {count} selected sessions. It cannot be undone.',
        cancel: 'Cancel',
        confirmAction: 'Delete',
        deleting: 'Deleting...',
        confirmChecking: 'Checking subagents...',

        subagentTitle: 'Subagents to delete',
        targetsLabel: 'Sessions',
        selectAllAll: 'Select all',
        selectAllHint: 'Select subagents from every conversation',
        selectNoneHint: 'Clear every selection',
        selectNone: 'Select none',
        groupSelf: 'Derived by this session',
        relFamilyBranches: '{count} branches',
        relSource: 'source',
        relSibling: 'sibling',
        groupCountHint: '{count} subagent(s)',
        toggleBlockHint: 'Select/deselect this conversation: {title}',
        blockCountHint: '{count} subagent(s)',
        blockSelected: '{selected}/{total} selected',
        toggleGroupHint: 'Select/deselect all: {title}',
        selectedSummary: '{count} selected · {size}',
        depthLabel: 'depth {depth}',
      },
    };

    let currentLocaleService = null;
    let appCtx = null;

    /**
     * 若被删除的会话正好是主视图当前打开的会话，通过官方 uiWorkspace.clearMain() 卸载视图返回主界面
     */
    function clearIfCurrentSession(targetSessionId) {
      if (!targetSessionId || !appCtx) return;
      try {
        const uiWorkspace = appCtx.get ? appCtx.get('uiWorkspace') : null;
        if (!uiWorkspace) return;

        const currentId =
          uiWorkspace.mainReference?.sessionId || uiWorkspace.selection?.getSnapshot?.()?.sessionId;

        const shouldClear = Array.isArray(targetSessionId)
          ? Boolean(currentId) && targetSessionId.includes(currentId)
          : Boolean(currentId) && targetSessionId === currentId;

        if (shouldClear && typeof uiWorkspace.clearMain === 'function') {
          uiWorkspace.clearMain();
        }
      } catch (err) {
        console.warn('[dsh-plugin-delete-archived] clearIfCurrentSession failed:', err);
      }
    }

    function getActiveLocale() {
      if (currentLocaleService?.getSnapshot) {
        try {
          const snapshot = currentLocaleService.getSnapshot();
          if (snapshot?.active) {
            return snapshot.active.startsWith('zh') ? 'zh' : 'en';
          }
        } catch {}
      }
      return 'en';
    }

    function useLocale() {
      const [lang, setLang] = useState(() => getActiveLocale());
      useEffect(() => {
        if (!currentLocaleService?.subscribe) return;
        const sync = () => setLang(getActiveLocale());
        const off = currentLocaleService.subscribe(sync);
        sync();
        return () => {
          if (typeof off === 'function') off();
        };
      }, []);
      return lang;
    }

    function t(key, params, overrideLang) {
      const lang = overrideLang || getActiveLocale();
      const dict = LOCALES[lang] || LOCALES.en;
      let text = dict[key] || LOCALES.en[key] || key;
      if (params && typeof params === 'object') {
        for (const [k, v] of Object.entries(params)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    }

    // ==================== 删除确认弹窗的共享状态 ====================
    /**
     * 菜单项与设置页都在各自的 React 树里，而确认弹窗必须挂在 root 作用域的
     * `shell.overlay` 上（行菜单卸载后弹窗仍需存活，官方重命名/归档弹窗同理）。
     * 因此用一个模块级可订阅存储把「删除请求」从发起方传递给弹窗。
     */
    let requestSeq = 0;
    const deleteRequestStore = (() => {
      let state = null;
      const listeners = new Set();
      const emit = () => {
        for (const listener of [...listeners]) listener();
      };
      return {
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        set: (next) => {
          state = next;
          emit();
        },
      };
    })();

    /**
     * 发起一次删除请求：立即打开弹窗（检查态），随后异步取回子代理明细。
     *
     * `onDone` 与 `onCancel` 互斥且各自至多触发一次：删除成功走 onDone，
     * 用户在弹窗中取消（或关闭）走 onCancel，避免发起方状态永久卡在「处理中」。
     *
     * @param sessionIds - 待删除的会话 id 列表
     * @param displayTitle - 单会话时的标题，用于弹窗文案
     * @param handlers.onDone - 删除成功后的回调（设置页据此刷新列表）
     * @param handlers.onCancel - 用户取消删除后的回调
     */
    function requestSessionDeletion(sessionIds, displayTitle, handlers = {}) {
      requestSeq += 1;
      const requestId = requestSeq;
      deleteRequestStore.set({
        requestId,
        sessionIds: [...sessionIds],
        displayTitle,
        loading: true,
        error: null,
        info: null,
        settled: false,
        onDone: handlers.onDone,
        onCancel: handlers.onCancel,
      });

      fetch('/api/archived-sessions/descendants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionIds: [...sessionIds] }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok || json.error) throw new Error(json.error || res.statusText);
          return json;
        })
        .then((info) => {
          const current = deleteRequestStore.getSnapshot();
          if (!current || current.requestId !== requestId) return;
          deleteRequestStore.set({ ...current, loading: false, info });
        })
        .catch((err) => {
          const current = deleteRequestStore.getSnapshot();
          if (!current || current.requestId !== requestId) return;
          // 血缘检查失败不阻断删除本身：退化为「仅删除会话」
          deleteRequestStore.set({
            ...current,
            loading: false,
            info: { totalSubagents: 0, totalSharedSubagents: 0, groups: [], sharedGroups: [] },
            error: t('requestError', { error: String(err?.message || err) }),
          });
        });
    }

    /** 关闭弹窗并通知发起方：用户取消。settled 保证回调至多触发一次。 */
    function closeDeleteRequest() {
      const current = deleteRequestStore.getSnapshot();
      deleteRequestStore.set(null);
      if (current && !current.settled) {
        current.settled = true;
        try {
          current.onCancel?.();
        } catch (err) {
          console.warn('[dsh-plugin-delete-archived] onCancel failed:', err);
        }
      }
    }

    /** 关闭弹窗并通知发起方：删除已成功。 */
    function settleDeleteRequest(result) {
      const current = deleteRequestStore.getSnapshot();
      deleteRequestStore.set(null);
      if (current && !current.settled) {
        current.settled = true;
        try {
          current.onDone?.(result);
        } catch (err) {
          console.warn('[dsh-plugin-delete-archived] onDone failed:', err);
        }
      }
    }

    // ==================== 样式注入 ====================
    //
    // 全部沿用 DSH 官方设计令牌（--dsw-*），并复刻官方组件的排版尺度：
    // Modal 标题 16px/24px/500、正文 14px/22px；设置行标题 14px/20px、
    // 描述 12px/18px + label-secondary。以此与 DSH 原生界面保持一致的观感。
    const STYLE_ID = 'dsh-plugin-delete-archived-styles';
    function ensureStylesInjected() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .dsh-da-container {
          padding: 12px 16px;
          width: 100%;
          box-sizing: border-box;
          color: var(--dsw-alias-label-primary, inherit);
          font-family: inherit;
        }

        /* ---------- 按钮：对齐官方 Button 的尺寸与描边 ---------- */
        .dsh-da-btn {
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          height: 28px;
          padding: 0 10px;
          border: 0.5px solid var(--dsw-alias-border-l3, rgba(125, 125, 125, 0.35));
          border-radius: var(--dsw-radius-sm, 6px);
          background: transparent;
          color: var(--dsw-alias-label-primary, inherit);
          font-size: 12px;
          line-height: 18px;
          cursor: pointer;
          user-select: none;
          transition: background 0.15s ease, border-color 0.15s ease;
        }
        .dsh-da-btn:hover:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-hover, rgba(125, 125, 125, 0.12));
        }
        .dsh-da-btn:active:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-active, rgba(125, 125, 125, 0.18));
        }
        .dsh-da-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        /* 危险操作：与官方归档删除按钮同一处理（透明底 + 错误色描边） */
        .dsh-da-danger {
          color: var(--dsw-alias-state-error-primary, #e5484d) !important;
          border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 40%, transparent) !important;
        }
        .dsh-da-danger:hover:not(:disabled) {
          background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 10%, transparent) !important;
        }

        /* ---------- 表格 ---------- */
        .dsh-da-table-wrap {
          border: 0.5px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18));
          border-radius: var(--dsw-radius-md, 6px);
          overflow: hidden;
        }
        .dsh-da-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
          text-align: left;
        }
        .dsh-da-th {
          padding: 8px 10px;
          background: var(--dsw-alias-bg-layer-2, rgba(125, 125, 125, 0.06));
          border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18));
          color: var(--dsw-alias-label-secondary, inherit);
          font-weight: 500;
          user-select: none;
        }
        .dsh-da-tr + .dsh-da-tr {
          border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.12));
        }
        .dsh-da-td {
          padding: 8px 10px;
          vertical-align: middle;
        }
        .dsh-da-col-divide {
          border-left: 0.5px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18));
        }
        /* 副行的目录标识：可伸缩、单行省略（不换行不撑高） */
        .dsh-da-mono {
          flex: 1;
          min-width: 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          line-height: 16px;
          color: var(--dsw-alias-label-tertiary, inherit);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* 主列标题：单行省略，保证行高一致 */
        .dsh-da-row-title {
          font-weight: 500;
          line-height: 18px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* 副行：目录标识 + 文件夹按钮同排 */
        .dsh-da-row-sub {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        /* 图标按钮（打开文件夹）：
           平时低对比度、鼠标移到该行才显形 —— 既不干扰阅读，又能被看见。
           只放图标不放文字，靠 FolderOpen 图标语义 + title 提示表达用途。 */
        .dsh-da-icon-btn {
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          padding: 0;
          border: none;
          border-radius: var(--dsw-radius-sm, 6px);
          background: transparent;
          color: var(--dsw-alias-label-tertiary, inherit);
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
        }
        .dsh-da-tr:hover .dsh-da-icon-btn,
        .dsh-da-icon-btn:focus-visible {
          opacity: 1;
        }
        .dsh-da-icon-btn:hover {
          background: var(--dsw-alias-interactive-bg-hover, rgba(125, 125, 125, 0.12));
          color: var(--dsw-alias-label-primary, inherit);
        }
        .dsh-da-icon-btn > svg {
          width: 14px;
          height: 14px;
        }
        /* 子代理徽标组：间距 6px，窄列下也不挤压 */
        .dsh-da-badges {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .dsh-da-secondary {
          color: var(--dsw-alias-label-secondary, inherit);
        }

        /* ---------- 弹窗内容 ---------- */
        /* 宽度与「内容可滚动」照官方 RiskConfirmation：含列表的确认框用 440px，
           且滚动加在 Modal 的 content 包装层上（该层含标题栏 + 正文），
           底部按钮区保持固定可见。

           高度必须用 dvh 而不是 100%：官方 Modal 的 .root 是 flex 居中容器
           （display:flex + align-items:center），弹窗在里面按**内容高度**撑开，
           百分比高度没有确定基准可依，max-height:100% 会失效 ——
           实测子代理较多时弹窗会被撑到 1356px，远超视口，底部按钮被推出屏幕。
           改用视口单位后，内容区自己滚动，按钮区始终可见。 */
        .dsh-da-modal {
          width: min(440px, 100%);
          /* 官方 .root 的上下内边距各 24px，所以留 48px 余量 */
          max-height: calc(100dvh - 48px);
          overflow: hidden;
        }
        @supports not (height: 100dvh) {
          .dsh-da-modal {
            max-height: calc(100vh - 48px);
          }
        }
        .dsh-da-modal-content {
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .dsh-da-dialog-body {
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
          font-size: 14px;
          line-height: 22px;
        }
        /* 警示行：图标与文字必须同行顶部对齐（图标不参与换行） */
        .dsh-da-warning {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          color: var(--dsw-alias-label-secondary, inherit);
        }
        .dsh-da-warning > svg {
          flex: none;
          margin-top: 2px;
          color: var(--dsw-alias-state-error-primary, #e5484d);
        }
        .dsh-da-warning p {
          margin: 0;
          min-width: 0;
        }

        /* ---------- 子代理选择器 ----------
           排版尺度取自官方 DisclosureRow.module.css：
             行高 24px、leading 盒 16px + 右间距 6px、标题 13px/24px
           以及官方 Tag.module.css 的胶囊规格（radius 999px / padding 1px 8px /
           11px / line-height 17px / 500）。以此与 DSH 原生界面同尺度。 */
        .dsh-da-picker {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        /* 顶栏：标题 + 全选/全不选。整行 24px，与 DisclosureRow 齐平。
           动作按钮紧随标题**左对齐**，避免鼠标横跨到弹窗右侧。 */
        .dsh-da-picker-head {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 10px;
          height: 24px;
          padding: 0 8px;
          min-width: 0;
        }
        .dsh-da-picker-title {
          font-size: 13px;
          line-height: 24px;
          font-weight: 500;
          color: var(--dsw-alias-label-primary, inherit);
          flex: none;
        }
        .dsh-da-picker-actions {
          display: inline-flex;
          gap: 10px;
          flex: none;
        }
        .dsh-da-link {
          border: none;
          background: none;
          padding: 0;
          color: var(--dsw-alias-state-business-primary, #3b82f6);
          font-size: 12px;
          line-height: 18px;
          cursor: pointer;
        }
        .dsh-da-link:hover:not(:disabled) {
          text-decoration: underline;
        }
        .dsh-da-link:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* 批量删除时的会话总览行：列出本次涉及的会话名，
           让下面的分组有明确对照对象，不必靠组名反推「在删哪几个」。 */
        .dsh-da-targets {
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-width: 0;
        }
        .dsh-da-targets-label {
          flex: none;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-size: 12px;
          line-height: 18px;
        }
        .dsh-da-targets-list {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          min-width: 0;
        }
        .dsh-da-target-chip {
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          padding: 1px 8px;
          border-radius: 999px;
          background: var(--dsw-alias-bg-module-platform, rgba(125, 125, 125, 0.12));
          color: var(--dsw-alias-label-secondary, inherit);
          font-size: 11px;
          line-height: 17px;
        }
        /* 家族规模标注：把「含 N 个分支」这类信息以更淡的色阶附在家族名后，
           与家族名同处一个胶囊内，读起来是一体而不是两个独立标签。 */
        .dsh-da-target-branches {
          margin-left: 4px;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-variant-numeric: tabular-nums;
        }
        /* 总览胶囊里的短 id：同名家族的区分依据，用等宽数字便于逐位比对 */
        .dsh-da-target-id {
          margin-left: 4px;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-variant-numeric: tabular-nums;
        }
        /* ---------- 家族块 ---------- */
        /*
         * 两层结构，视觉语言必须分开，否则看不出主次：
         *
         *   家族块 .dsh-da-block        ← **同一段对话**的整体，带边框
         *     └─ 组 .dsh-da-group       ← 块内的「本会话 / 源对话 / 兄弟分支」，无边框
         *   块与块之间 .dsh-da-block-divider ← 只有这里才是「隔阂」
         *
         * 早先给每个**组**都加了边框、又在每两组之间加分隔线，
         * 结果满屏分界线，看不出「哪几行属于同一段对话」。
         */
        .dsh-da-block {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        /* 家族块本体：把「本会话 + 源对话 + 兄弟分支」圈成一个整体。
           用 inset 阴影当边框：不占布局宽度，勾选框的 x 坐标不会被推移。 */
        .dsh-da-block-body {
          display: flex;
          flex-direction: column;
          min-width: 0;
          border-radius: var(--dsw-radius-md, 6px);
          box-shadow: inset 0 0 0 0.5px var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18));
          overflow: hidden;
        }
        /* 家族块之间的隔阂 —— 这才是用户要的「分隔」。
           第一个块之前不加，避免顶部多一条多余线。 */
        .dsh-da-block-divider {
          height: 0;
          margin: 8px 0;
          border-top: 0.5px solid var(--dsw-alias-border-l3, rgba(125, 125, 125, 0.24));
        }
        /* 块头：整块全选 + 家族标识。
           高度与组头同为 26px，勾选框与块内各组的勾选框落在同一条竖线上。 */
        .dsh-da-block-head {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          height: 26px;
          padding: 0 8px;
          background: var(--dsw-alias-bg-module-platform, rgba(125, 125, 125, 0.06));
        }
        /* 家族名：可伸缩、超出省略，完整文本走 title */
        .dsh-da-block-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--dsw-alias-label-primary, inherit);
          font-size: 12px;
          font-weight: 500;
        }
        /* 短 id：同名家族的**唯一**区分依据，固定不收缩、不被截断 */
        .dsh-da-block-id {
          flex: none;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-size: 11px;
          line-height: 16px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        /* 块级计数：已选 N/M 或总条数 */
        .dsh-da-block-meta {
          flex: none;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-size: 11px;
          line-height: 16px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        /* ---------- 分组（块内） ---------- */
        .dsh-da-group {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        /* 块内组之间：一条极淡的细线，只做「同一整体内部的分界」，
           不能和块间的隔阂线一个强度，否则又变成满屏分界线。 */
        .dsh-da-group-sep {
          height: 0;
          border-top: 0.5px solid var(--dsw-alias-border-l1, rgba(125, 125, 125, 0.1));
        }
        /* 组头：勾选框 + 折叠箭头 + 来源说明 + 计数。高度对齐官方 24px 行。
           勾选框固定在最左，与子项的勾选框共用同一条竖线，鼠标无需横跨。 */
        .dsh-da-group-head {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          height: 26px;
          padding: 0 8px;
        }
        /* 组头文字加粗一点：有分隔线后，加粗能让「这是组」更明确 */
        .dsh-da-group-who {
          font-weight: 500;
        }
        /* 折叠触发区：只包箭头与文字，复选框独立可点，互不干扰 */
        .dsh-da-group-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
          padding: 0;
          border: none;
          background: none;
          color: var(--dsw-alias-label-secondary, inherit);
          font-size: 12px;
          line-height: 24px;
          text-align: left;
          cursor: pointer;
        }
        .dsh-da-group-toggle:hover {
          color: var(--dsw-alias-label-primary, inherit);
        }
        /* 箭头：16px 盒 + 6px 右间距，官方 DisclosureRow .leading 同规格 */
        .dsh-da-chevron {
          flex: none;
          width: 16px;
          height: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-right: 0;
          color: currentColor;
          transition: transform 100ms ease;
        }
        .dsh-da-chevron[data-open='true'] {
          transform: rotate(180deg);
        }
        .dsh-da-chevron > svg {
          width: 14px;
          height: 14px;
        }
        /* 分组标题：超出宽度时以省略号收尾。
           三个条件缺一不可 —— flex 子项必须能收缩（min-width:0）、
           不换行（nowrap）、并在自身裁掉溢出（overflow:hidden + ellipsis）。
           完整文本仍通过 title 属性提供，悬停可看全。 */
        .dsh-da-group-who {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        /* 关系标签：固定不收缩、不截断。长对话名被省略时，关系信息仍完整可见。 */
        .dsh-da-group-rel {
          flex: none;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-size: 11px;
          line-height: 16px;
          white-space: nowrap;
        }
        /* 计数徽标：官方 Tag outline 规格 */
        .dsh-da-count {
          flex: none;
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 1px 8px;
          font-size: 11px;
          line-height: 17px;
          font-weight: 500;
          white-space: nowrap;
          border: 0.5px solid var(--dsw-alias-border-l4, rgba(125, 125, 125, 0.3));
          color: var(--dsw-alias-label-tertiary, inherit);
          font-variant-numeric: tabular-nums;
        }

        /*
         * 列表本身不再画边框、也不再左缩进 ——
         * 边框由外层 .dsh-da-group 统一提供，组头与子项才会连成一体（接合）。
         * 左缩进去掉后，组头与子项的勾选框落在同一条竖线上（实测 x 一致）。
         */
        .dsh-da-list {
          display: flex;
          flex-direction: column;
          max-height: 168px;
          overflow-y: auto;
          overscroll-behavior: contain;
          border: none;
          /* 组头与子项之间用一条细线分界，同时让二者看起来同属一块 */
          border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18));
        }
        /* 每条 24px，与官方 DisclosureRow 行高一致；勾选框与组头同一左内边距 */
        .dsh-da-item {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 24px;
          padding: 2px 8px;
          font-size: 12px;
          line-height: 18px;
        }
        .dsh-da-item + .dsh-da-item {
          border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.12));
        }
        .dsh-da-item-main {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        /* 条目只显示一个名字（优先 label），占满剩余宽度，超出时省略号收尾。
           完整文本通过 title 属性提供，悬停可看。 */
        .dsh-da-item-name {
          flex: 1;
          min-width: 0;
          color: var(--dsw-alias-label-primary, inherit);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dsh-da-item-size {
          flex: none;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-size: 11px;
          line-height: 17px;
          font-variant-numeric: tabular-nums;
        }
        /* 深层后代标记（第 2 层起才显示） */
        .dsh-da-item-depth {
          flex: none;
          color: var(--dsw-alias-label-tertiary, inherit);
          font-size: 11px;
          line-height: 17px;
        }
        /* 官方 Checkbox 的 label 为空时会渲染一个空 span，与复选框之间多出 gap。
           本插件的复选框靠旁边的文字表达语义，因此把空 span 收掉。 */
        .dsh-da-checkbox > span:empty {
          display: none;
        }
        .dsh-da-picker-summary {
          color: var(--dsw-alias-label-tertiary, inherit);
          font-size: 12px;
          line-height: 18px;
          padding-top: 2px;
        }
        .dsh-da-status {
          color: var(--dsw-alias-label-secondary, inherit);
          font-size: 12px;
          line-height: 18px;
        }
        .dsh-da-error {
          color: var(--dsw-alias-state-error-primary, #e5484d);
          font-size: 12px;
          line-height: 18px;
          word-break: break-all;
        }

        /* ---------- 无官方 primitives 时的自包含回退 ---------- */
        .dsh-da-fallback-mask {
          position: fixed;
          inset: 0;
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.45));
        }
        .dsh-da-fallback-dialog {
          box-sizing: border-box;
          width: min(440px, 100%);
          max-height: 100%;
          overflow-y: auto;
          padding: 22px 24px 24px;
          border-radius: var(--dsw-radius-panel, 12px);
          background: var(--dsw-alias-bg-layer-2, #1b1b1f);
          color: var(--dsw-alias-label-primary, inherit);
          box-shadow: var(--dsw-elevation-prominent, 0 16px 48px rgba(0, 0, 0, 0.45));
        }
        .dsh-da-fallback-title {
          margin: 0 0 12px;
          font-size: 16px;
          line-height: 24px;
          font-weight: 500;
        }
        .dsh-da-fallback-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 20px;
        }
        .dsh-da-fallback-btn {
          box-sizing: border-box;
          height: 36px;
          padding: 0 14px;
          border: 0.5px solid var(--dsw-alias-border-l3, rgba(125, 125, 125, 0.35));
          border-radius: var(--dsw-radius-md, 8px);
          background: transparent;
          color: var(--dsw-alias-label-primary, inherit);
          font-size: 14px;
          line-height: 22px;
          cursor: pointer;
        }
        .dsh-da-fallback-btn:hover:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-hover, rgba(125, 125, 125, 0.12));
        }
        .dsh-da-fallback-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `;
      document.head.appendChild(style);
    }

    // ==================== 图标 ====================
    function TrashIcon({ size = 12, color = 'currentColor' }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: color,
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flexShrink: 0 },
        },
        h('polyline', { points: '3 6 5 6 21 6' }),
        h('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
        h('line', { x1: '10', y1: '11', x2: '10', y2: '17' }),
        h('line', { x1: '14', y1: '11', x2: '14', y2: '17' })
      );
    }

    function RestoreIcon({ size = 12, color = 'currentColor' }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: color,
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flexShrink: 0 },
        },
        h('polyline', { points: '1 4 1 10 7 10' }),
        h('path', { d: 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10' })
      );
    }

    function BranchIcon({ size = 11, color = 'currentColor' }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: color,
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          style: { flexShrink: 0 },
        },
        h('line', { x1: '6', y1: '3', x2: '6', y2: '15' }),
        h('circle', { cx: '18', cy: '6', r: '3' }),
        h('circle', { cx: '6', cy: '18', r: '3' }),
        h('path', { d: 'M18 9a9 9 0 0 1-9 9' })
      );
    }

    // ==================== 官方组件的薄封装（带自包含回退） ====================
    /**
     * 弹窗宽度与「内容可滚动」都照官方 `RiskConfirmation`：官方 Modal 默认
     * `min(380px, 100%)`，而含列表的确认框用 `min(440px, 100%)`。本弹窗要列出
     * 分组后的子代理，因此由 `.dsh-da-modal` 类覆盖为 440px，与官方同类弹窗一致。
     */
    function DialogShell({ title, footer, onClose, children }) {
      if (PModal) {
        return h(
          PModal,
          {
            open: true,
            onClose,
            closeLabel: t('cancel'),
            title,
            footer,
            // 与官方 RiskConfirmation 同一套做法：宽度加在 dialog 上，
            // 滚动加在 content 包装层上（该层同时含标题栏与正文）。
            className: 'dsh-da-modal',
            contentClassName: 'dsh-da-modal-content',
          },
          children
        );
      }
      return h(
        'div',
        { className: 'dsh-da-fallback-mask', onClick: onClose },
        h(
          'div',
          { className: 'dsh-da-fallback-dialog', onClick: (e) => e.stopPropagation() },
          h('h3', { className: 'dsh-da-fallback-title' }, title),
          children,
          h('div', { className: 'dsh-da-fallback-footer' }, footer)
        )
      );
    }

    function DialogButton({ danger = false, disabled = false, onClick, children }) {
      if (PButton) {
        return h(
          PButton,
          { variant: 'outline', className: danger ? 'dsh-da-danger' : undefined, disabled, onClick },
          children
        );
      }
      return h(
        'button',
        {
          type: 'button',
          className: danger ? 'dsh-da-fallback-btn dsh-da-danger' : 'dsh-da-fallback-btn',
          disabled,
          onClick,
        },
        children
      );
    }

    function OptionCheckbox({ checked, disabled, label, onChange, className, title }) {
      // className / title 需要透传给官方组件：className 用于收掉空 label 的间隙，
      // title 让复选框本身带无障碍提示（图标按钮旁的复选框没有可见文字）
      if (PCheckbox) {
        return h(PCheckbox, {
          checked,
          disabled,
          label,
          onChange,
          ...(className ? { className } : null),
          ...(title ? { title } : null),
        });
      }
      return h(
        'label',
        {
          className,
          title,
          style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' },
        },
        h('input', {
          type: 'checkbox',
          checked,
          disabled,
          onChange: (e) => onChange(e.target.checked),
          style: { width: '16px', height: '16px', margin: 0, accentColor: 'var(--dsw-alias-brand-primary)' },
        }),
        label ? h('span', null, label) : null
      );
    }

    /**
     * 徽标：优先官方 Tag，回退为同令牌的 span。
     *
     * tone 直接使用官方 Tag 的 tone 值（outline / neutral / info / quiet 等），
     * 让「本会话派生」与「同家族其他对话派生」用不同色调区分，避免两个徽标
     * 长得一样而无法分辨。
     */
    function Badge({ children, title, tone = 'outline' }) {
      if (PTag) return h(PTag, { tone, title }, children);
      const palette = {
        outline: {
          border: '0.5px solid var(--dsw-alias-border-l4, rgba(125,125,125,0.3))',
          color: 'var(--dsw-alias-label-tertiary, inherit)',
        },
        info: {
          border: '0.5px solid transparent',
          background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #3b82f6) 10%, transparent)',
          color: 'var(--dsw-alias-state-business-primary, #3b82f6)',
        },
        neutral: {
          border: '0.5px solid transparent',
          background: 'var(--dsw-alias-bg-module-platform, rgba(125,125,125,0.12))',
          color: 'var(--dsw-alias-label-secondary, inherit)',
        },
      };
      const style = palette[tone] ?? palette.outline;
      return h(
        'span',
        {
          title,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '1px 8px',
            borderRadius: '999px',
            fontSize: '11px',
            lineHeight: '17px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            ...style,
          },
        },
        children
      );
    }

    // ==================== 删除确认弹窗 ====================

    function DeleteConfirmDialog() {
      // 弹窗可能从侧边栏菜单直接打开，此时设置页从未挂载过，样式必须在这里自行确保
      ensureStylesInjected();
      // 订阅共享请求状态；useLocale 保证切换语言时文案同步刷新
      const request = useSyncExternalStore(deleteRequestStore.subscribe, deleteRequestStore.getSnapshot);
      useLocale();

      if (request === null) return null;
      // key 绑定 requestId：新请求必定得到全新草稿，旧请求的在途状态随卸载销毁
      return h(DeleteConfirmForm, { key: request.requestId, request });
    }

    function DeleteConfirmForm({ request }) {
      const isBatch = request.sessionIds.length > 1;
      const info = request.info;

      /**
       * 把 own / shared 统一整理成「按派生者分组」的列表，每组都带上：
       * - who：派生者标题与它相对本会话的关系（本会话 / 源对话 / 兄弟分支）
       * - items：该派生者创建的每个子代理（可单独勾选）
       * 这样用户既能看清每个子代理来自哪一段对话，也能只删其中一部分。
       *
       * 返回的是**家族块**（两层）：一个块 = 同一段对话的「本会话 + 源对话 + 兄弟分支」，
       * 块之间才分隔。见 buildSubagentBlocks 的说明。
       */
      const blocks = buildSubagentBlocks(info);
      /** 展平出所有组，供勾选逻辑使用 */
      const allGroups = blocks.flatMap((b) => b.groups);

      /**
       * 勾选状态。弹窗先以「检查中」态挂载，`info` 返回后本组件**不会重新初始化**
       * useState，因此不能用 useState 初始化式表达默认值 —— 那样只会在 groups
       * 还是空的时候算一次，默认勾选会永远失效。
       *
       * 这里改为：`draft === null` 表示「用户尚未改动」，此时按规则派生默认值
       * （勾选本会话自己派生的），用户一旦勾选就固化为 draft。
       */
      const [draft, setDraft] = useState(null);
      const [processing, setProcessing] = useState(false);
      const [error, setError] = useState(null);

      const defaultSelected = (() => {
        const init = new Set();
        for (const g of allGroups) if (g.isOwn) for (const it of g.items) init.add(it.id);
        return init;
      })();
      const selected = draft ?? defaultSelected;
      // 用函数式更新，基准值在更新时才解析，避免同一 tick 内连续勾选读到过期集合
      const setSelected = (next) => {
        setDraft((prev) => {
          const base = prev ?? defaultSelected;
          return typeof next === 'function' ? next(base) : next;
        });
      };

      const toggleOne = (id) => {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };
      const toggleGroup = (g) => {
        setSelected((prev) => {
          const next = new Set(prev);
          const allOn = g.items.every((it) => next.has(it.id));
          for (const it of g.items) {
            if (allOn) next.delete(it.id);
            else next.add(it.id);
          }
          return next;
        });
      };

      /**
       * 整块（整个家族）全选 / 全不选。
       *
       * 为什么需要：顶栏的「全选」会**跨家族**把别的块也选上，
       * 而块内想一次选完（本会话 + 源对话 + 兄弟分支）只能逐组点。
       * 有了块级开关，就能「只删这一段的子代理」而不牵动其他家族。
       */
      const toggleBlock = (block) => {
        setSelected((prev) => {
          const next = new Set(prev);
          const ids = block.groups.flatMap((g) => g.items.map((it) => it.id));
          const allOn = ids.every((id) => next.has(id));
          for (const id of ids) {
            if (allOn) next.delete(id);
            else next.add(id);
          }
          return next;
        });
      };

      const totalCount = allGroups.reduce((n, g) => n + g.items.length, 0);
      const selectedCount = selected.size;
      const selectedSize = allGroups
        .flatMap((g) => g.items)
        .filter((it) => selected.has(it.id))
        .reduce((n, it) => n + (it.sizeBytes || 0), 0);

      /**
       * 本次涉及的**家族**清单（用于批量时的总览行）。
       *
       * 按家族列而不是按会话列：A 与 A-1 是一段对话的两个分支，列成两条
       * 会让用户以为要删两段对话。一条家族名 + 「N 个分支」才准确。
       *
       * 同时带上**短 id**：fork 分支继承父标题，同一批里出现多个同名家族是常态，
       * 只给名字的话总览里会看到几个一模一样的胶囊，根本分不清哪个是哪个。
       */
      const familyChips = blocks.map((b) => ({
        name: b.title,
        shortId: b.shortId,
        branches: b.memberCount ?? 1,
      }));

      const close = () => {
        if (processing) return;
        closeDeleteRequest();
      };

      const confirm = async () => {
        setProcessing(true);
        setError(null);
        // 精确传递用户勾选的子代理 id；未勾选任何子代理时不带该字段
        const subagentIds = [...selected];
        try {
          const res = await fetch(
            isBatch ? '/api/archived-sessions/delete-batch' : '/api/archived-sessions/delete',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                isBatch
                  ? { sessionIds: request.sessionIds, subagentIds }
                  : { sessionId: request.sessionIds[0], subagentIds }
              ),
            }
          );
          const json = await res.json();
          if (!res.ok || json.error) throw new Error(json.error || res.statusText);

          clearIfCurrentSession(request.sessionIds);
          settleDeleteRequest(json);
        } catch (err) {
          setError(t('requestError', { error: String(err?.message || err) }));
          setProcessing(false);
        }
      };

      const title = isBatch
        ? t('confirmTitleBatch', { count: request.sessionIds.length })
        : t('confirmTitle');

      const body = h(
        'div',
        { className: 'dsh-da-dialog-body' },
        // 警示行：图标 + 一行说明（与官方 RiskConfirmation 同一排版）
        h(
          'div',
          { className: 'dsh-da-warning' },
          PIconWarning ? h(PIconWarning, { size: 18 }) : null,
          h(
            'p',
            null,
            isBatch
              ? t('confirmDescBatch', { count: request.sessionIds.length })
              : request.displayTitle
              ? t('confirmDescNamed', { title: request.displayTitle })
              : t('confirmDesc')
          )
        ),
        request.loading
          ? h('div', { className: 'dsh-da-status', role: 'status' }, t('confirmChecking'))
          : null,
        /**
         * 批量删除时列出**涉及哪些家族**。
         *
         * 为什么需要：多个会话各自派生子代理时，下面会出现好几个家族块，
         * 但用户看不到「这次到底在删哪几个」，只能靠块名反推。这里给一行总览，
         * 让下面的分块有明确的对照对象。
         *
         * 为什么每条都带短 id：fork 分支**继承父标题**，同一批里出现
         * 「生成 2 个子代理让他们回复 1」重复两三遍是常态 ——
         * 只给名字的话这一行会变成几个一模一样的胶囊，等于没给。
         */
        isBatch && !request.loading && familyChips.length > 0
          ? h(
              'div',
              { className: 'dsh-da-targets' },
              h('span', { className: 'dsh-da-targets-label' }, t('targetsLabel')),
              h(
                'span',
                { className: 'dsh-da-targets-list' },
                familyChips.map((chip, i) =>
                  h(
                    'span',
                    {
                      key: `${chip.shortId}-${i}`,
                      className: 'dsh-da-target-chip',
                      // 完整文本（名字 + 短 id）走 title，悬停可看全
                      title: `${chip.name} · ${chip.shortId}`,
                    },
                    chip.name,
                    // 短 id 是区分同名家族的**唯一**依据，必须显示
                    h('span', { className: 'dsh-da-target-id' }, chip.shortId),
                    // 多分支家族补一个「N 分支」标注，表明这不是单个会话
                    chip.branches > 1
                      ? h('span', { className: 'dsh-da-target-branches' }, `·${chip.branches}`)
                      : null
                  )
                )
              )
            )
          : null,
        // 子代理：按「哪一段对话（家族）创建的」分块，每条可单独勾选
        totalCount > 0
          ? h(SubagentPicker, {
              blocks,
              selected,
              disabled: processing,
              onToggleOne: toggleOne,
              onToggleGroup: toggleGroup,
              onToggleBlock: toggleBlock,
              onSelectAll: () =>
                setSelected(new Set(allGroups.flatMap((g) => g.items).map((it) => it.id))),
              onSelectNone: () => setSelected(new Set()),
              summary: t('selectedSummary', { count: selectedCount, size: formatSize(selectedSize) }),
            })
          : null,
        processing ? h('div', { className: 'dsh-da-status', role: 'status' }, t('deleting')) : null,
        error !== null ? h('div', { className: 'dsh-da-error', role: 'alert' }, error) : null
      );

      const footer = h(
        Fragment,
        null,
        h(DialogButton, { disabled: processing, onClick: close }, t('cancel')),
        h(DialogButton, { danger: true, disabled: processing, onClick: confirm }, t('confirmAction'))
      );

      return h(DialogShell, { title, footer, onClose: close }, body);
    }

    /** 前端本地格式化字节（仅用于勾选汇总，避免为一次预览多跑一次请求） */
    function formatSize(bytes) {
      if (!bytes || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      let v = bytes;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
    }

    /**
     * 把后端数据整理成**按家族分块**的可勾选列表。
     *
     * 结构是两层，不是一层：
     *
     *   家族块（block）  ← 一个整体，用边框圈起来
     *     ├─ 本会话组      （本次要删的会话派生的，默认勾选）
     *     ├─ 源对话组      （同家族的源对话派生的，默认不勾）
     *     └─ 兄弟分支组    （同家族的其他分支派生的，默认不勾）
     *   家族块之间才用分隔线
     *
     * 为什么必须是两层：同家族的「本会话 / 源对话 / 兄弟分支」都源于**同一段对话**，
     * 它们属于一个整体；只有**另一个会话的家族**才是另一个整体。
     * 早先把边框与分隔线都铺在单个组上，结果满屏分界线，看不出主次。
     *
     * - `isOwn` 为 true 表示该组的子代理由**本次要删的会话**派生（默认勾选）
     * - 同族的其他组默认不勾选，并标明它是源对话还是兄弟分支
     */
    function buildSubagentBlocks(info) {
      if (!info) return [];
      const blocks = [];

      for (const g of info.groups ?? []) {
        if ((g.subagents ?? []).length === 0) continue;

        const rootId = g.familyRootId;
        // 家族块标题：取家族根（通常就是源对话 A）的标题，最能代表整段对话
        const title = g.familyTitle || shortId(rootId) || '—';

        // 该家族的成员数（本次要删的会话数），用于标注「含 N 个分支」
        const memberCount = (g.memberIds ?? []).length;

        const groups = [
          {
            key: `family:${rootId}`,
            isOwn: true,
            whoTitle: title,
            // 多成员家族标注分支数，让用户知道这一段对话跨了几个分支
            memberCount,
            relation: 'family',
            items: sortItems(g.subagents),
          },
        ];

        // 把同家族的「源对话 / 兄弟分支」并进同一个块
        for (const s of info.sharedGroups ?? []) {
          if ((s.subagents ?? []).length === 0) continue;
          // 只归入本家族；familyRootId 缺失时按 owner 自身判断，避免错挂
          const belongs = s.familyRootId
            ? s.familyRootId === rootId
            : s.ownerSessionId === rootId;
          if (!belongs) continue;
          groups.push({
            key: `shared:${s.ownerSessionId}`,
            isOwn: false,
            whoTitle: s.ownerTitle || shortId(s.ownerSessionId),
            relation: s.relation === 'source' ? 'source' : 'sibling',
            items: sortItems(s.subagents),
          });
        }

        blocks.push({
          key: `block:${rootId}`,
          // 家族根 id 保留下来：块标题可能重名（fork 分支继承父标题），
          // 界面靠短 id 才能把两个同名家族区分开
          rootId,
          shortId: shortId(rootId),
          title,
          memberCount,
          groups,
        });
      }

      return blocks;
    }

    function sortItems(items) {
      return [...items].sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return ta - tb;
      });
    }

    /**
     * 子代理选择器：每个派生者一个分组，组内逐条可勾选。
     *
     * 视觉规格对齐官方 `DisclosureRow`：行高 24px、折叠箭头 16px 盒（内含 14px 图标）、
     * 标题 13px/24px；计数徽标用官方 `Tag` 的 outline 胶囊规格。
     *
     * 折叠规则：**只有「非本会话派生」的分组默认折叠**。这些分组来自源对话或兄弟
     * 分支，默认不勾选，收起来能让弹窗在常见情况下保持简洁；本会话自己派生的分组
     * 默认展开，因为它默认勾选、需要被看到。
     */
    function SubagentPicker({
      blocks,
      selected,
      disabled,
      onToggleOne,
      onToggleGroup,
      onToggleBlock,
      onSelectAll,
      onSelectNone,
      summary,
    }) {
      /** 所有组（跨块展平），供折叠与勾选逻辑使用 */
      const groups = blocks.flatMap((b) => b.groups);

      // 折叠状态：键为分组 key，值为是否展开。未记录时按「是否本会话派生」取默认值
      const [collapsed, setCollapsed] = useState(() => {
        const init = new Map();
        for (const g of groups) if (!g.isOwn) init.set(g.key, true);
        return init;
      });
      const isOpen = (g) => !(collapsed.get(g.key) ?? !g.isOwn);
      const toggleOpen = (g) => {
        setCollapsed((prev) => {
          const next = new Map(prev);
          next.set(g.key, isOpen(g));
          return next;
        });
      };

      /**
       * 分组标题拆成两段，让「对话名」独占可伸缩宽度：
       * - 标题：家族名（取家族根，通常是源对话 A），可截断（省略号）
       * - 关系标签：家族成员数或来源说明，固定宽度、永不截断
       *
       * 这样长对话名被截断时，标签仍然完整可见 —— 若把两者拼成一整句，
       * 前缀会把真正有用的对话名挤到只剩几个字。
       */
      const groupTitle = (g) => g.whoTitle || t('groupSelf');

      const groupRel = (g) => {
        // 本会话派生的那组：明确标出「本会话派生」，让用户一眼认出哪块是本次要删的
        if (g.relation === 'family') {
          const own = t('groupSelf');
          // 成员多于 1 时补上「含 N 个分支」，说明这一段对话跨了几个分支
          return (g.memberCount ?? 0) > 1
            ? `${own} · ${t('relFamilyBranches', { count: g.memberCount })}`
            : own;
        }
        if (g.relation === 'source') return t('relSource');
        if (g.relation === 'sibling') return t('relSibling');
        return null;
      };

      return h(
        'div',
        { className: 'dsh-da-picker' },
        h(
          'div',
          { className: 'dsh-da-picker-head' },
          h('span', { className: 'dsh-da-picker-title' }, t('subagentTitle')),
          h(
            'span',
            { className: 'dsh-da-picker-actions' },
            /*
             * 这两个是**跨家族**的全局动作，文案上必须说清楚，
             * 否则用户会误以为只作用于某一段对话。
             * 只删某一段对话的子代理，用每个家族块头左侧的勾选框。
             */
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-da-link',
                disabled,
                title: t('selectAllHint'),
                onClick: onSelectAll,
              },
              t('selectAllAll')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-da-link',
                disabled,
                title: t('selectNoneHint'),
                onClick: onSelectNone,
              },
              t('selectNone')
            )
          )
        ),
        blocks.map((block, bi) => {
          const blockItems = block.groups.flatMap((g) => g.items);
          const blockAllOn = blockItems.length > 0 && blockItems.every((it) => selected.has(it.id));
          const blockSomeOn = blockItems.some((it) => selected.has(it.id));
          const blockSelCount = blockItems.filter((it) => selected.has(it.id)).length;

          return h(
            'div',
            { key: block.key, className: 'dsh-da-block' },
            // 家族块之间才加隔阂：第一个之前不加，避免顶部多一条多余线
            bi > 0 ? h('div', { className: 'dsh-da-block-divider', role: 'separator' }) : null,
            /*
             * 家族块：同一段对话的「本会话 + 源对话 + 兄弟分支」圈成**一个整体**。
             * 块内各组不画边框、也不加分隔线，只有块本身有边框 ——
             * 这样一眼就能看出「哪几行属于同一段对话」。
             */
            h(
              'div',
              { className: 'dsh-da-block-body' },
              /*
               * 块头：家族标识 + 整块全选。
               *
               * 为什么块头要带短 id：fork 分支**继承父会话标题**，于是同一家族的
               * 名字几乎一样（「生成 2 个子代理让他们回复 1」/「…(1)」/「…(2)」），
               * 再被省略号一截就完全分不清。短 id 是唯一稳定的区分依据。
               */
              h(
                'div',
                { className: 'dsh-da-block-head' },
                h(OptionCheckbox, {
                  checked: blockAllOn,
                  disabled,
                  label: '',
                  className: 'dsh-da-checkbox',
                  title: t('toggleBlockHint', { title: block.title }),
                  onChange: () => onToggleBlock(block),
                }),
                h(
                  'span',
                  { className: 'dsh-da-block-title', title: block.title },
                  block.title
                ),
                // 短 id：同名家族的区分依据
                h('span', { className: 'dsh-da-block-id' }, block.shortId),
                h(
                  'span',
                  { className: 'dsh-da-block-meta' },
                  // 有选中时显示「已选 N/M」，让用户清楚这一块选了多少
                  blockSomeOn && !blockAllOn
                    ? t('blockSelected', { selected: blockSelCount, total: blockItems.length })
                    : t('blockCountHint', { count: blockItems.length })
                )
              ),
              block.groups.map((g, gi) => {
                const open = isOpen(g);
                const allOn = g.items.every((it) => selected.has(it.id));
                const label = groupTitle(g);
                const rel = groupRel(g);
                const fullLabel = rel ? `${label} · ${rel}` : label;

                return h(
                  'div',
                  { key: g.key, className: 'dsh-da-group' },
                  // 块内组之间用一条极淡的细线分界（不是块间的隔阂线）
                  gi > 0 ? h('div', { className: 'dsh-da-group-sep' }) : null,
                  h(
                    'div',
                    { className: 'dsh-da-group-head' },
                    // 勾选框固定在最左：鼠标从条目区上来时不必横跨弹窗
                    h(OptionCheckbox, {
                      checked: allOn,
                      disabled,
                      label: '',
                      className: 'dsh-da-checkbox',
                      title: t('toggleGroupHint', { title: fullLabel }),
                      onChange: () => onToggleGroup(g),
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-da-group-toggle',
                        'aria-expanded': open,
                        // 完整文本走 title：被省略号截断时悬停可看全
                        title: fullLabel,
                        onClick: () => toggleOpen(g),
                      },
                      // 箭头：官方 chevron，展开时旋转 180°
                      h(
                        'span',
                        { className: 'dsh-da-chevron', 'data-open': open ? 'true' : 'false' },
                        PIconChevron
                          ? h(PIconChevron, null)
                          : h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }, h('path', { d: 'M6 9l6 6 6-6' }))
                      ),
                      h('span', { className: 'dsh-da-group-who' }, label),
                      rel ? h('span', { className: 'dsh-da-group-rel' }, rel) : null
                    ),
                    h(
                      'span',
                      { className: 'dsh-da-count', title: t('groupCountHint', { count: g.items.length }) },
                      `${g.items.length}`
                    )
                  ),
                  open
                    ? h(
                        'div',
                        { className: 'dsh-da-list', role: 'group' },
                        g.items.map((it) =>
                          h(
                            'div',
                            { key: it.id, className: 'dsh-da-item', role: 'listitem' },
                            h(OptionCheckbox, {
                              checked: selected.has(it.id),
                              disabled,
                              label: '',
                              className: 'dsh-da-checkbox',
                              // 悬停显示完整文本：标题常被省略号截断，且降级标题并非全文
                              title: it.title || shortId(it.id),
                              onChange: () => onToggleOne(it.id),
                            }),
                            h(
                              'div',
                              { className: 'dsh-da-item-main' },
                              /**
                               * 只显示一个名字，优先用 descriptor label（如「子代理四」）。
                               *
                               * 为什么不并排显示标题：DSH 的降级标题在**同一批子代理里
                               * 完全相同**（实测 6 个共用同一个标题），并排显示只会重复
                               * 6 遍同样的噪音，还把真正有区分度的 label 挤窄。
                               * 完整文本仍走 title 属性，悬停可看。
                               *
                               * 没有 label 时才退回标题 —— 否则这一行会空掉。
                               */
                              h(
                                'span',
                                { className: 'dsh-da-item-name' },
                                it.label || it.title || shortId(it.id)
                              ),
                              it.depth > 1
                                ? h('span', { className: 'dsh-da-item-depth' }, t('depthLabel', { depth: it.depth }))
                                : null
                            ),
                            h('span', { className: 'dsh-da-item-size' }, it.sizeFormatted)
                          )
                        )
                      )
                    : null
                );
              })
            )
          );
        }),
        h('div', { className: 'dsh-da-picker-summary' }, summary)
      );
    }
    // ==================== 侧边栏会话菜单项 ====================
    function DeleteArchivedMenuItem(props) {
      const { sessionId, displayTitle, useMenuOpenState } = props;
      const [hovered, setHovered] = useState(false);

      const setMenuOpen = typeof useMenuOpenState === 'function' ? useMenuOpenState()?.[1] : undefined;

      const handleDelete = (e) => {
        e.stopPropagation();
        e.preventDefault();

        try {
          setMenuOpen?.(false);
        } catch {}

        // 打开确认弹窗；弹窗自身会异步检查子代理并提供一并删除的选项
        requestSessionDeletion([sessionId], displayTitle || sessionId);
      };

      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          onClick: handleDelete,
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            width: '100%',
            height: '32px',
            padding: '0 8px',
            boxSizing: 'border-box',
            borderRadius: 'var(--dsw-radius-md, 6px)',
            border: 'none',
            background: hovered
              ? 'var(--dsw-alias-interactive-bg-hover, rgba(125,125,125,0.12))'
              : 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: '13px',
            color: 'var(--dsw-alias-state-error-primary, #e5484d)',
            userSelect: 'none',
            transition: 'background 0.15s ease',
          },
        },
        h(TrashIcon, { size: 14, color: 'var(--dsw-alias-state-error-primary, #e5484d)' }),
        h(
          'span',
          { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          t('menuItem')
        )
      );
    }

    // ==================== 设置面板 ====================
    function PageHeader() {
      return h(
        'div',
        { style: { marginBottom: '12px' } },
        h(
          'h2',
          { style: { margin: '0 0 4px', fontSize: '16px', lineHeight: '24px', fontWeight: 500 } },
          t('title')
        ),
        h(
          'p',
          {
            style: {
              margin: 0,
              fontSize: '12px',
              lineHeight: '18px',
              color: 'var(--dsw-alias-label-secondary, inherit)',
            },
          },
          t('desc')
        )
      );
    }

    function FeedbackBanner({ message }) {
      if (!message) return null;
      const isError = message.type === 'error';
      return h(
        'div',
        {
          style: {
            padding: '6px 12px',
            borderRadius: 'var(--dsw-radius-sm, 6px)',
            marginBottom: '12px',
            fontSize: '12px',
            lineHeight: '18px',
            color: isError
              ? 'var(--dsw-alias-state-error-primary, #e5484d)'
              : 'var(--dsw-alias-label-primary, inherit)',
            border: '0.5px solid currentColor',
          },
        },
        message.text
      );
    }

    function ActionToolbar({
      processing,
      loading,
      onRefresh,
      selectedCount,
      totalCount,
      onDeleteSelected,
      onRestoreSelected,
    }) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
            gap: '8px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h(
            'button',
            { type: 'button', disabled: processing || loading, onClick: onRefresh, className: 'dsh-da-btn' },
            t('refresh')
          ),
          selectedCount > 0 &&
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              h(
                'button',
                {
                  type: 'button',
                  disabled: processing,
                  onClick: onDeleteSelected,
                  className: 'dsh-da-btn dsh-da-danger',
                },
                h(TrashIcon, { size: 12, color: 'currentColor' }),
                t('deleteSelected', { count: selectedCount })
              ),
              h(
                'button',
                { type: 'button', disabled: processing, onClick: onRestoreSelected, className: 'dsh-da-btn' },
                h(RestoreIcon, { size: 12, color: 'currentColor' }),
                t('restoreSelected')
              )
            )
        ),
        totalCount > 0 &&
          h(
            'span',
            {
              style: {
                fontSize: '12px',
                lineHeight: '18px',
                color: 'var(--dsw-alias-label-secondary, inherit)',
              },
            },
            t('totalCount', { count: totalCount })
          )
      );
    }

    /**
     * 把会话 id 缩成便于辨认的短标识。
     * 完整 id 交给 title 属性；表格里只需要能区分彼此即可。
     */
    function shortId(id) {
      if (!id) return '—';
      // session-3013b00a-0f8b-418a-bdb1-5129305a9223 → session-3013b00a
      const m = /^(session-)([0-9a-f]{8})/i.exec(id);
      if (m) return m[1] + m[2];
      return id.length > 16 ? id.slice(0, 8) + '…' : id;
    }

    function SessionTable({ sessions, selectedIds, onToggleSelect, onToggleSelectAll, onOpenFolder, lang }) {
      return h(
        'div',
        { className: 'dsh-da-table-wrap' },
        h(
          'table',
          { className: 'dsh-da-table' },
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              h(
                'th',
                { className: 'dsh-da-th', style: { width: '36px' } },
                h('input', {
                  type: 'checkbox',
                  checked: selectedIds.size > 0 && selectedIds.size === sessions.length,
                  onChange: onToggleSelectAll,
                  style: { cursor: 'pointer', accentColor: 'var(--dsw-alias-brand-primary)' },
                })
              ),
              h('th', { className: 'dsh-da-th', style: { width: '38%' } }, t('colTitle')),
              h('th', { className: 'dsh-da-th dsh-da-col-divide', style: { width: '16%' } }, t('colSubagent')),
              h('th', { className: 'dsh-da-th dsh-da-col-divide', style: { width: '24%' } }, t('colWorkspace')),
              h('th', { className: 'dsh-da-th dsh-da-col-divide', style: { width: '22%' } }, t('colDate'))
            )
          ),
          h(
            'tbody',
            null,
            sessions.map((s) => {
              const isSelected = selectedIds.has(s.id);
              const formattedDate = s.createdAt
                ? new Date(s.createdAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')
                : '-';
              const own = s.subagentCount ?? 0;
              const shared = s.sharedSubagentCount ?? 0;

              return h(
                'tr',
                { key: s.id, className: 'dsh-da-tr' },
                h(
                  'td',
                  { className: 'dsh-da-td' },
                  h('input', {
                    type: 'checkbox',
                    checked: isSelected,
                    onChange: () => onToggleSelect(s.id),
                    style: { cursor: 'pointer', accentColor: 'var(--dsw-alias-brand-primary)' },
                  })
                ),
                h(
                  'td',
                  { className: 'dsh-da-td' },
                  h(
                    'div',
                    {
                      className: 'dsh-da-row-title',
                      title: s.title || shortId(s.id),
                    },
                    s.title || shortId(s.id)
                  ),
                  /**
                   * 副行：短标识（会话 id + 体积）+ **打开物理目录的快捷入口**。
                   *
                   * 副行只放短标识而不铺整条绝对路径 —— 像
                   * `C:\Users\Seelerc\.dsh\sessions\--E-DeepSeek~0020Harness-1--\session-7ea740e7`
                   * 这样的字符串会占掉主列绝大部分宽度，把会话标题挤成配角；
                   * 路径对「确认删哪个」帮助很小，体积才有。完整路径移交 title 悬停查看。
                   *
                   * 文件夹按钮紧跟在目录标识后面（与它同排），只放图标不放文字：
                   *   - 官方 FolderOpen 图标本身就是「打开文件夹」的通用语义；
                   *   - title / aria-label 给出「在文件管理器中打开」的提示。
                   * 平时低对比度，鼠标移到该行才显形，避免干扰阅读。
                   */
                  h(
                    'div',
                    { className: 'dsh-da-row-sub' },
                    h(
                      'span',
                      {
                        className: 'dsh-da-mono',
                        title: s.diskPath || s.id,
                      },
                      `${shortId(s.id)} · ${s.sizeFormatted || '0 B'}`
                    ),
                    s.diskPath
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-da-icon-btn',
                            title: t('openFolder'),
                            'aria-label': t('openFolder'),
                            onClick: (e) => {
                              e.stopPropagation();
                              onOpenFolder(s.diskPath);
                            },
                          },
                          PIconFolder
                            ? h(PIconFolder, null)
                            : h(
                                'svg',
                                {
                                  viewBox: '0 0 24 24',
                                  fill: 'none',
                                  stroke: 'currentColor',
                                  strokeWidth: 2,
                                  strokeLinecap: 'round',
                                  strokeLinejoin: 'round',
                                },
                                h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' })
                              )
                        )
                      : null
                  )
                ),
                h(
                  'td',
                  { className: 'dsh-da-td dsh-da-col-divide' },
                  own > 0 || shared > 0
                    ? h(
                        'span',
                        { className: 'dsh-da-badges' },
                        // 本会话派生的用实心徽标（默认勾选、会被删除）
                        own > 0
                          ? h(
                              Badge,
                              {
                                tone: 'neutral',
                                title: `${t('badgeOwnHint', { count: own })} · ${s.subagentSizeFormatted || '0 B'}`,
                              },
                              h(BranchIcon, { size: 11, color: 'currentColor' }),
                              `${own}`
                            )
                          : null,
                        // 同家族其他对话派生的用描边徽标（默认保留、仅提示存在）
                        shared > 0
                          ? h(
                              Badge,
                              {
                                tone: 'outline',
                                title: `${t('badgeSharedHint', { count: shared })} · ${s.sharedSubagentSizeFormatted || '0 B'}`,
                              },
                              h(BranchIcon, { size: 11, color: 'currentColor' }),
                              `${shared}`
                            )
                          : null
                      )
                    : h('span', { className: 'dsh-da-secondary' }, '—')
                ),
                h(
                  'td',
                  { className: 'dsh-da-td dsh-da-col-divide' },
                  h(
                    'span',
                    {
                      className: 'dsh-da-secondary',
                      style: { wordBreak: 'break-all' },
                      title: s.workspaceTitle || t('unassigned'),
                    },
                    s.workspaceTitle || t('unassigned')
                  )
                ),
                h(
                  'td',
                  {
                    className: 'dsh-da-td dsh-da-col-divide',
                    style: { whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary, inherit)' },
                  },
                  formattedDate
                )
              );
            })
          )
        )
      );
    }

    function ArchivedSessionsSettingsSection() {
      ensureStylesInjected();
      const lang = useLocale();

      const [sessions, setSessions] = useState([]);
      const [loading, setLoading] = useState(true);
      const [selectedIds, setSelectedIds] = useState(new Set());
      const [message, setMessage] = useState(null);
      const [processing, setProcessing] = useState(false);

      const loadList = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
          const res = await fetch('/api/archived-sessions');
          const data = await res.json();
          if (data && Array.isArray(data.sessions)) {
            const sorted = [...data.sessions].sort((a, b) => {
              const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return timeA - timeB;
            });
            setSessions(sorted);
            const availableSet = new Set(sorted.map((s) => s.id));
            setSelectedIds((prev) => new Set([...prev].filter((id) => availableSet.has(id))));
          } else {
            setSessions([]);
            setSelectedIds(new Set());
          }
        } catch (err) {
          setMessage({ type: 'error', text: t('requestError', { error: String(err?.message || err) }) });
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        loadList();
      }, [loadList]);

      const toggleSelect = (id) => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };

      const toggleSelectAll = () => {
        if (selectedIds.size === sessions.length && sessions.length > 0) {
          setSelectedIds(new Set());
        } else {
          setSelectedIds(new Set(sessions.map((s) => s.id)));
        }
      };

      /**
       * 在系统文件管理器中打开该会话的物理目录（后端已有 open-folder 路由）。
       * 失败不打断列表：只把错误放进顶部提示条。
       */
      const handleOpenFolder = async (folderPath) => {
        if (!folderPath) return;
        try {
          const res = await fetch('/api/archived-sessions/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: folderPath }),
          });
          if (!res.ok) {
            const json = await res.json().catch(() => ({}));
            throw new Error(json.error || res.statusText);
          }
        } catch (e) {
          setMessage({ type: 'error', text: t('requestError', { error: String(e?.message || e) }) });
        }
      };

      const handleRestoreSelected = async () => {
        const count = selectedIds.size;
        if (count === 0) return;
        setProcessing(true);
        try {
          const res = await fetch('/api/archived-sessions/restore-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionIds: Array.from(selectedIds) }),
          });
          const json = await res.json();
          if (res.ok && json.success) {
            setMessage({ type: 'success', text: t('restoreBatchSuccess', { count: json.restoredCount }) });
            setSelectedIds(new Set());
            await loadList();
          } else {
            setMessage({ type: 'error', text: t('requestError', { error: json.error || 'Unknown error' }) });
          }
        } catch (e) {
          setMessage({ type: 'error', text: t('requestError', { error: String(e?.message || e) }) });
        } finally {
          setProcessing(false);
        }
      };

      // 批量删除：先弹确认窗，由用户在窗内决定是否连带删除子代理
      const handleDeleteSelected = () => {
        const count = selectedIds.size;
        if (count === 0) return;

        setProcessing(true);
        requestSessionDeletion(Array.from(selectedIds), null, {
          onDone: (json) => {
            const subagentDeleted = json.deletedSubagentCount ?? 0;
            setMessage({
              type: 'success',
              text:
                subagentDeleted > 0
                  ? t('deleteBatchSuccessWithSub', { count: json.deletedCount, sub: subagentDeleted })
                  : t('deleteBatchSuccess', { count: json.deletedCount }),
            });
            setSelectedIds(new Set());
            setProcessing(false);
            loadList();
          },
          // 用户在确认窗中取消：必须复位，否则工具栏按钮会永久禁用
          onCancel: () => setProcessing(false),
        });
      };

      return h(
        'div',
        { className: 'dsh-da-container' },
        h(PageHeader),
        h(FeedbackBanner, { message }),
        h(ActionToolbar, {
          processing,
          loading,
          onRefresh: loadList,
          selectedCount: selectedIds.size,
          totalCount: sessions.length,
          onDeleteSelected: handleDeleteSelected,
          onRestoreSelected: handleRestoreSelected,
        }),
        loading
          ? h(
              'div',
              {
                style: {
                  padding: '24px',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--dsw-alias-label-secondary, inherit)',
                },
              },
              t('loading')
            )
          : sessions.length === 0
          ? h(
              'div',
              {
                style: {
                  padding: '28px 16px',
                  textAlign: 'center',
                  border: '0.5px dashed var(--dsw-alias-border-l3, rgba(125,125,125,0.35))',
                  borderRadius: 'var(--dsw-radius-md, 6px)',
                  fontSize: '12px',
                  color: 'var(--dsw-alias-label-secondary, inherit)',
                },
              },
              t('empty')
            )
          : h(SessionTable, {
              sessions,
              selectedIds,
              onToggleSelect: toggleSelect,
              onToggleSelectAll: toggleSelectAll,
              onOpenFolder: handleOpenFolder,
              lang,
            })
      );
    }

    // ==================== 插件入口 ====================
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        currentLocaleService = ctx.locale;
        appCtx = ctx;

        // 0. 全局删除确认弹窗（root 作用域，不随侧边栏行菜单卸载）
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'delete-archived-confirm', order: 500 },
            DeleteConfirmDialog
          )
        );

        // 1. 侧边栏单个会话 "..." 菜单项
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'delete-archived-session', order: 450 },
            DeleteArchivedMenuItem
          )
        );

        // 2. 设置中心的独立管理页面
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'archived-sessions', order: 25, label: () => t('navLabel') },
            ArchivedSessionsSettingsSection
          )
        );
      },
    };
  },
});
