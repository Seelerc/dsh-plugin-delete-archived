window.__ModuleLoader__.load({
  id: 'dsh-plugin-delete-archived',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useCallback, createElement: h } = React;

    // ==================== 国际化资源字典 ====================
    const LOCALES = {
      zh: {
        menuItem: '彻底删除会话',
        menuConfirm: '确定要彻底删除会话 “{title}” 吗？\n\n注意：此操作将永久抹除磁盘上的对话记录与日志文件，不可恢复！',
        title: '已归档会话管理',
        desc: '管理并安全清理已归档的会话记录。彻底删除后将释放物理磁盘空间且不可撤销。',
        refresh: '刷新',
        deleteSelected: '彻底删除 ({count})',
        deleteSelectedConfirm: '确定要彻底删除所选的 {count} 个已归档会话吗？\n对应的所有磁盘历史文件夹将被永久清除，无法撤销！',
        restoreSelected: '恢复',
        totalCount: '共 {count} 个已归档会话',
        loading: '正在加载已归档列表...',
        empty: '当前没有已归档的会话记录。',
        colTitle: '会话标题 / 磁盘目录标注',
        colWorkspace: '所属工作区',
        colDate: '归档时间',
        unassigned: '未分组',
        restoreBatchSuccess: '已成功恢复 {count} 个会话到工作区',
        deleteBatchSuccess: '已彻底删除 {count} 个会话',
        requestError: '请求出错: {error}',
        navLabel: '已归档会话',
      },
      en: {
        menuItem: 'Delete Permanently',
        menuConfirm: 'Are you sure you want to permanently delete session "{title}"?\n\nNote: This will permanently erase the session history and disk logs and cannot be undone!',
        title: 'Archived Sessions Management',
        desc: 'Manage and permanently clean up archived sessions. Deleting them frees disk space and cannot be undone.',
        refresh: 'Refresh',
        deleteSelected: 'Delete Selected ({count})',
        deleteSelectedConfirm: 'Are you sure you want to permanently delete the {count} selected archived sessions?\nAll corresponding disk history folders will be permanently removed!',
        restoreSelected: 'Restore',
        totalCount: 'Total {count} archived session(s)',
        loading: 'Loading archived sessions...',
        empty: 'No archived sessions found.',
        colTitle: 'Session Title / Disk Directory',
        colWorkspace: 'Workspace',
        colDate: 'Archived At',
        unassigned: 'Unassigned',
        restoreBatchSuccess: 'Successfully restored {count} session(s) to workspace',
        deleteBatchSuccess: 'Successfully deleted {count} session(s)',
        requestError: 'Request error: {error}',
        navLabel: 'Archived Sessions',
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
          uiWorkspace.mainReference?.sessionId ||
          uiWorkspace.selection?.getSnapshot?.()?.sessionId;

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

    // ==================== 自包含全局样式注入 ====================
    const STYLE_ID = 'dsh-plugin-delete-archived-styles';
    function ensureStylesInjected() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .dsh-da-container {
          padding: 12px 16px;
          color: var(--dsw-alias-label-primary, inherit);
          width: 100%;
          box-sizing: border-box;
          font-family: inherit;
        }
        .dsh-da-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 28px;
          padding: 0 10px;
          border-radius: var(--dsw-radius-sm, 6px);
          border: 1px solid var(--dsw-alias-border-l1, rgba(125, 125, 125, 0.2));
          background: transparent !important;
          color: var(--dsw-alias-label-primary, inherit);
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          user-select: none;
          transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
        }
        .dsh-da-btn:hover:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-hover, rgba(125, 125, 125, 0.12)) !important;
          border-color: var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.35));
        }
        .dsh-da-btn:active:not(:disabled) {
          transform: scale(0.97);
        }
        .dsh-da-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        /* 官方 DSH 危险轮廓按钮样式（透明底色，适配深色/浅色模式） */
        .dsh-da-btn-danger {
          background: transparent !important;
          color: var(--dsw-alias-state-error-primary, #e5484d) !important;
          border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 30%, transparent) !important;
          outline: none !important;
        }
        .dsh-da-btn-danger:hover:not(:disabled) {
          background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 8%, transparent) !important;
          border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 45%, transparent) !important;
          color: var(--dsw-alias-state-error-primary, #e5484d) !important;
        }
        .dsh-da-btn-danger:focus,
        .dsh-da-btn-danger:focus-visible {
          outline: none !important;
          border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 45%, transparent) !important;
        }
        .dsh-da-btn-danger:active:not(:disabled) {
          background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 14%, transparent) !important;
          border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #e5484d) 50%, transparent) !important;
        }
        .dsh-da-table-wrap {
          border: 1px solid var(--dsw-alias-border-l1, rgba(125, 125, 125, 0.18));
          border-radius: var(--dsw-radius-md, 6px);
          overflow: hidden;
          background: var(--dsw-alias-bg-layer-1, transparent);
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
          border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(125, 125, 125, 0.18));
          color: var(--dsw-alias-label-secondary, inherit);
          font-weight: 600;
          user-select: none;
        }
        .dsh-da-tr {
          border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.08));
        }
        .dsh-da-tr:last-child {
          border-bottom: none;
        }
        .dsh-da-td {
          padding: 8px 10px;
          vertical-align: middle;
        }
        .dsh-da-col-border-l {
          border-left: 1px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18)) !important;
        }
        .dsh-da-col-workspace {
          border-left: 1px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18)) !important;
          border-right: 1px solid var(--dsw-alias-border-l2, rgba(125, 125, 125, 0.18)) !important;
        }
        .dsh-da-workspace-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 100%;
          color: var(--dsw-alias-label-secondary, inherit);
          font-size: 12px;
          word-break: break-all;
        }
      `;
      document.head.appendChild(style);
    }

    // ==================== 图标组件 ====================
    function TrashIcon({ size = 13, color = 'currentColor' }) {
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

    // ==================== 侧边栏会话菜单项 ====================
    function DeleteArchivedMenuItem(props) {
      const { sessionId, displayTitle, useMenuOpenState } = props;
      const [hovered, setHovered] = useState(false);

      const setMenuOpen = typeof useMenuOpenState === 'function' ? useMenuOpenState()?.[1] : undefined;

      const handleDelete = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const titleText = displayTitle || sessionId;
        const msg = t('menuConfirm', { title: titleText });
        if (!window.confirm(msg)) return;

        try {
          setMenuOpen?.(false);
        } catch {}

        try {
          const res = await fetch('/api/archived-sessions/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId }),
          });
          const json = await res.json();
          if (!res.ok || json.error) {
            alert(t('requestError', { error: json.error || res.statusText }));
          } else {
            clearIfCurrentSession(sessionId);
          }
        } catch (err) {
          alert(t('requestError', { error: String(err?.message || err) }));
        }
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
            background: hovered ? 'var(--dsw-alias-state-error-subtle, rgba(229, 72, 77, 0.12))' : 'transparent',
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: '13px',
            color: 'var(--dsw-alias-state-error-primary, #e5484d)',
            userSelect: 'none',
            transition: 'background 0.15s ease',
          },
        },
        h(TrashIcon, { size: 14, color: 'var(--dsw-alias-state-error-primary, #e5484d)' }),
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t('menuItem'))
      );
    }

    // ==================== 子组件：页面头部 ====================
    function PageHeader() {
      return h(
        'div',
        { style: { marginBottom: '10px' } },
        h('h2', { style: { margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600 } }, t('title')),
        h(
          'p',
          {
            style: {
              margin: 0,
              fontSize: '12px',
              color: 'var(--dsw-alias-label-secondary, #a1a1aa)',
              lineHeight: '1.4',
            },
          },
          t('desc')
        )
      );
    }

    // ==================== 子组件：操作反馈横幅 ====================
    function FeedbackBanner({ message }) {
      if (!message) return null;
      const isError = message.type === 'error';
      return h(
        'div',
        {
          style: {
            padding: '6px 12px',
            borderRadius: 'var(--dsw-radius-sm, 4px)',
            marginBottom: '10px',
            fontSize: '12px',
            backgroundColor: isError
              ? 'var(--dsw-alias-state-error-subtle, rgba(229, 72, 77, 0.15))'
              : 'var(--dsw-alias-state-success-subtle, rgba(48, 164, 108, 0.15))',
            color: isError
              ? 'var(--dsw-alias-state-error-primary, #e5484d)'
              : 'var(--dsw-alias-state-success-primary, #30a46c)',
            border: '1px solid currentColor',
          },
        },
        message.text
      );
    }

    // ==================== 子组件：工具栏 ====================
    function ActionToolbar({ processing, loading, onRefresh, selectedCount, totalCount, onDeleteSelected, onRestoreSelected }) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            gap: '8px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          h(
            'button',
            {
              type: 'button',
              disabled: processing || loading,
              onClick: onRefresh,
              className: 'dsh-da-btn',
            },
            t('refresh')
          ),
          selectedCount > 0 &&
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              h(
                'button',
                {
                  type: 'button',
                  disabled: processing,
                  onClick: onDeleteSelected,
                  className: 'dsh-da-btn dsh-da-btn-danger',
                },
                h(TrashIcon, { size: 12, color: 'currentColor' }),
                t('deleteSelected', { count: selectedCount })
              ),
              h(
                'button',
                {
                  type: 'button',
                  disabled: processing,
                  onClick: onRestoreSelected,
                  className: 'dsh-da-btn',
                },
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
                fontSize: '11px',
                color: 'var(--dsw-alias-label-tertiary, #71717a)',
              },
            },
            t('totalCount', { count: totalCount })
          )
      );
    }

    // ==================== 子组件：数据表格 ====================
    function SessionTable({ sessions, selectedIds, onToggleSelect, onToggleSelectAll, lang }) {
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
                { className: 'dsh-da-th', style: { width: '32px' } },
                h('input', {
                  type: 'checkbox',
                  checked: selectedIds.size > 0 && selectedIds.size === sessions.length,
                  onChange: onToggleSelectAll,
                  style: { cursor: 'pointer' },
                })
              ),
              h('th', { className: 'dsh-da-th dsh-da-col-border-l', style: { width: '54%' } }, t('colTitle')),
              h('th', { className: 'dsh-da-th dsh-da-col-workspace', style: { width: '23%' } }, t('colWorkspace')),
              h('th', { className: 'dsh-da-th', style: { width: '23%' } }, t('colDate'))
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
                    style: { cursor: 'pointer' },
                  })
                ),
                h(
                  'td',
                  { className: 'dsh-da-td dsh-da-col-border-l', style: { overflow: 'hidden' } },
                  h(
                    'div',
                    {
                      style: {
                        fontWeight: 600,
                        wordBreak: 'break-all',
                        lineHeight: '1.3',
                        color: 'var(--dsw-alias-label-primary, inherit)',
                      },
                      title: s.title || s.id,
                    },
                    s.title || s.id
                  ),
                  h(
                    'div',
                    null,
                    h(
                      'span',
                      {
                        style: {
                          fontSize: '11px',
                          color: 'var(--dsw-alias-label-tertiary, #71717a)',
                          fontFamily: 'ui-monospace, monospace',
                          marginTop: '2px',
                          wordBreak: 'break-all',
                          lineHeight: '1.25',
                        },
                        title: s.diskPath || s.id,
                      },
                      `📁 ${s.diskPath || s.id} (${s.sizeFormatted || '0 B'})`
                    )
                  )
                ),
                h(
                  'td',
                  { className: 'dsh-da-td dsh-da-col-workspace' },
                  h(
                    'span',
                    {
                      className: 'dsh-da-workspace-tag',
                      title: s.workspaceTitle || t('unassigned'),
                    },
                    s.workspaceTitle || t('unassigned')
                  )
                ),
                h(
                  'td',
                  {
                    className: 'dsh-da-td',
                    style: {
                      color: 'var(--dsw-alias-label-secondary, inherit)',
                      fontSize: '11px',
                      whiteSpace: 'nowrap',
                    },
                  },
                  formattedDate
                )
              );
            })
          )
        )
      );
    }

    // ==================== 设置面板：已归档会话管理 ====================
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

      // 批量恢复所选
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

      // 批量删除所选
      const handleDeleteSelected = async () => {
        const count = selectedIds.size;
        if (count === 0) return;
        if (!window.confirm(t('deleteSelectedConfirm', { count }))) return;

        setProcessing(true);
        try {
          const res = await fetch('/api/archived-sessions/delete-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionIds: Array.from(selectedIds) }),
          });
          const json = await res.json();
          if (res.ok && json.success) {
            clearIfCurrentSession(Array.from(selectedIds));
            setMessage({ type: 'success', text: t('deleteBatchSuccess', { count: json.deletedCount }) });
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
                  color: 'var(--dsw-alias-label-secondary, #a1a1aa)',
                  fontSize: '12px',
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
                  border: '1px dashed var(--dsw-alias-border-l1, #3f3f46)',
                  borderRadius: 'var(--dsw-radius-md, 6px)',
                  color: 'var(--dsw-alias-label-secondary, #a1a1aa)',
                  fontSize: '12px',
                },
              },
              t('empty')
            )
          : h(SessionTable, {
              sessions,
              selectedIds,
              onToggleSelect: toggleSelect,
              onToggleSelectAll: toggleSelectAll,
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

        // 1. 注入侧边栏单个会话 "..." 菜单项
        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'delete-archived-session',
              order: 450,
            },
            DeleteArchivedMenuItem
          )
        );

        // 2. 注入设置中心的独立管理页面
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'archived-sessions',
              order: 25,
              label: () => t('navLabel'),
            },
            ArchivedSessionsSettingsSection
          )
        );
      },
    };
  },
});
