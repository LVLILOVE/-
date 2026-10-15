/**
 * `AD-P02` 用户与任务管理（`CH-01` / `FR-ADM-04`~`FR-ADM-08`）—— 路径 `/admin/manage`
 * =============================================================================
 * 🔒 **三个 Tab，三类破坏性操作，文案必须彼此区分**（§5.6 / `QD-03`）：
 *
 *   | 操作       | 语义             | 可恢复 | 确认文案的关键字           |
 *   |------------|------------------|--------|---------------------------|
 *   | 停用账号   | `status=0`       | ✅ 可   | 「可随时重新启用」         |
 *   | 重置密码   | 改密 + 踢下线   | ❌ 不可 | 「该用户需用新密码登录」   |
 *   | 强制删任务 | **硬删除**       | ❌ 不可 | 「**不可恢复**」           |
 *
 * ⚠️ **最易犯的错是把管理侧的文案写成用户侧那样**。用户侧 `API-20` 是
 *   **软删除**、可由管理员查回，所以那边写「删除后可在回收路径恢复」是对的；
 *   管理侧 `API-27` 是**物理删除**，`predictions` / `metrics` 真的没了。
 *   沿用软删文案 = 欺骗用户，会让人事后才发现数据找不回来。
 *
 * 🔒 **强制删除沿用「逐字输入任务 ID」的二次确认**（与 `UX-P09-04` 同源纪律）：
 *   软删除要输 ID 是因为「查回麻烦」，硬删除要输 ID 是因为「**根本查不回**」。
 *
 * 🔒 **重置密码必须提示「旧登录态立即失效」**（`BE-41` 联动）：
 *   服务层 `token_version + 1`，用户手上的旧 Token 全部作废。
 *   不说清楚，管理员会以为「改完密码对方还在线」，反而去责怪用户。
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, adminApi } from '../api/client';
import Card from '../components/Card';
import NoticeBar from '../components/NoticeBar';
import { Skeleton } from '../components/Skeleton';
import type {
  AdminLogBrief,
  AdminTaskBrief,
  AdminUserBrief,
  TaskStatus,
} from '../types';

type TabKey = 'users' | 'tasks' | 'logs';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'users', label: '用户管理' },
  { key: 'tasks', label: '任务管理' },
  { key: 'logs', label: '操作日志' },
];

const STATUS_LABEL: Record<string, string> = {
  created: '已创建',
  running: '进行中',
  succeeded: '成功',
  failed: '失败',
};

const ROLE_LABEL: Record<string, string> = { user: '普通用户', admin: '管理员' };

/** `action='admin'` 时的子动作中文名（后端已把 `sub=` 拆好） */
const SUB_LABEL: Record<string, string> = {
  enable: '启用账号',
  disable: '停用账号',
  role_change: '变更角色',
  reset_pwd: '重置密码',
  hard_delete: '强制删除任务',
  switch_model: '切换模型版本',
};

const ACTION_LABEL: Record<string, string> = {
  login: '登录',
  register: '注册',
  logout: '登出',
  upload: '上传数据集',
  predict: '发起预测',
  export: '导出结果',
  delete: '删除任务',
  admin: '管理端操作',
};

export default function AdminManagePage() {
  const [tab, setTab] = useState<TabKey>('users');
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  // ---- 用户 Tab ----
  const [users, setUsers] = useState<AdminUserBrief[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userDraft, setUserDraft] = useState({ q: '', role: '' });
  const [userQuery, setUserQuery] = useState<{ q?: string; role?: string }>({});
  const [usersLoading, setUsersLoading] = useState(true);

  // ---- 任务 Tab ----
  const [tasks, setTasks] = useState<AdminTaskBrief[]>([]);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskPage, setTaskPage] = useState(1);
  /**
   * 🔴 任务搜索**必须有自己的草稿**（`D-04`）。
   *
   * 旧实现把任务 Tab 的搜索框也绑到了 `userDraft.q` —— 两个语义完全不同的
   * 筛选项共用一个 state，后果是：在「用户管理」输入邮箱 → 切到「任务管理」，
   * 任务搜索框里赫然是那串邮箱；点「查询」还会用它去搜任务名。
   * 草稿（输入框）与条件（真正查询用的 `taskQuery`）分离的原则见下，
   * 与用户 Tab 一致。
   */
  const [taskDraft, setTaskDraft] = useState({ q: '' });
  const [taskQuery, setTaskQuery] = useState<{ status?: TaskStatus; q?: string }>({});
  const [tasksLoading, setTasksLoading] = useState(true);

  // ---- 日志 Tab ----
  const [logs, setLogs] = useState<AdminLogBrief[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logQuery, setLogQuery] = useState<{ action?: string }>({});
  const [logsLoading, setLogsLoading] = useState(true);

  // ---- 二次确认状态 ----
  const [resetTarget, setResetTarget] = useState<AdminUserBrief | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [delTarget, setDelTarget] = useState<AdminTaskBrief | null>(null);
  const [typedId, setTypedId] = useState('');
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const r = await adminApi.listUsers({ page: userPage, size: 20, ...userQuery });
      setUsers(r.items);
      setUserTotal(r.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '用户列表加载失败');
    } finally {
      setUsersLoading(false);
    }
  }, [userPage, userQuery]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const r = await adminApi.listTasks({ page: taskPage, size: 20, ...taskQuery });
      setTasks(r.items);
      setTaskTotal(r.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '任务列表加载失败');
    } finally {
      setTasksLoading(false);
    }
  }, [taskPage, taskQuery]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const r = await adminApi.listLogs({ page: logPage, size: 20, ...logQuery });
      setLogs(r.items);
      setLogTotal(r.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作日志加载失败');
    } finally {
      setLogsLoading(false);
    }
  }, [logPage, logQuery]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);
  useEffect(() => {
    if (tab === 'tasks') void loadTasks();
  }, [tab, loadTasks]);
  useEffect(() => {
    if (tab === 'logs') void loadLogs();
  }, [tab, loadLogs]);

  async function toggleStatus(u: AdminUserBrief) {
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      await adminApi.updateUser(u.id, { status: u.status === 1 ? 0 : 1 });
      setOkMsg(`已${u.status === 1 ? '停用' : '启用'}账号 ${u.email}`);
      await loadUsers();
    } catch (e) {
      // 🔒 服务层的保护（不能停用自己/最后一个管理员）message 里带原因，直接展示
      setError(e instanceof ApiError ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleRole(u: AdminUserBrief) {
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const next = u.role === 'admin' ? 'user' : 'admin';
      await adminApi.updateUser(u.id, { role: next });
      setOkMsg(`已将 ${u.email} 的角色改为${ROLE_LABEL[next]}`);
      await loadUsers();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    if (!resetTarget) return;
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const r = await adminApi.resetPassword(resetTarget.id, newPwd);
      setOkMsg(`${r.message}（${r.email}，token_version=${r.token_version}）`);
      setResetTarget(null);
      setNewPwd('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '重置失败');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!delTarget) return;
    setBusy(true);
    setError('');
    setOkMsg('');
    try {
      const r = await adminApi.forceDeleteTask(delTarget.id);
      setOkMsg(r.message);
      setDelTarget(null);
      setTypedId('');
      await loadTasks();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '强制删除失败');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 新密码是否达标（与后端 `ResetPasswordRequest` 同源规则：≥8 位 + 字母 + 数字）。
   *
   * ⚠️ 单独算一次（`D-10`）：此前「提示文案 / 按钮 disabled / 按钮底色」各写了一遍，
   *    而**底色那份漏了字母与数字两条** —— 于是像 `12345678` 这种不合格密码会让
   *    按钮显示成"可点的红色"，实际点下去毫无反应（disabled 拦住了）。
   *    同一判据必须只有一个来源。
   */
  const pwdOk = newPwd.length >= 8 && /[a-zA-Z]/.test(newPwd) && /[0-9]/.test(newPwd);

  const userPages = Math.max(1, Math.ceil(userTotal / 20));
  const taskPages = Math.max(1, Math.ceil(taskTotal / 20));
  const logPages = Math.max(1, Math.ceil(logTotal / 20));

  return (
    <div className="flex flex-col gap-4" data-testid="admin-manage">
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border)' }} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className="px-4 py-2 text-[0.875rem]"
            style={{
              color: tab === t.key ? 'var(--primary)' : 'var(--text-2)',
              borderBottom: `2px solid ${tab === t.key ? 'var(--primary)' : 'transparent'}`,
              marginBottom: -1,
            }}
            data-testid={`tab-${t.key}`}
            onClick={() => {
              setError('');
              setOkMsg('');
              setTab(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <NoticeBar variant="danger" title="操作未完成">
          {error}
        </NoticeBar>
      )}
      {okMsg && (
        <NoticeBar variant="success" title="已完成" data-testid="ok-msg">
          {okMsg}
        </NoticeBar>
      )}

      {/* ==================== 用户管理 ==================== */}
      {tab === 'users' && (
        <Card
          title={`用户管理（${userTotal}）`}
          actions={
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setUserPage(1);
                setUserQuery({
                  ...(userDraft.q ? { q: userDraft.q } : {}),
                  ...(userDraft.role ? { role: userDraft.role } : {}),
                });
              }}
            >
              <input
                value={userDraft.q}
                onChange={(e) => setUserDraft((d) => ({ ...d, q: e.target.value }))}
                placeholder="邮箱或昵称"
                className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-[0.8125rem]"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                  width: '11rem',
                }}
                data-testid="user-search"
              />
              <select
                value={userDraft.role}
                onChange={(e) => setUserDraft((d) => ({ ...d, role: e.target.value }))}
                className="rounded-[var(--radius-md)] px-2 py-1.5 text-[0.8125rem]"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                }}
                data-testid="user-role-filter"
              >
                <option value="">全部角色</option>
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
              <button
                type="submit"
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem]"
                style={{ background: 'var(--primary)', color: 'var(--primary-fg)' }}
              >
                查询
              </button>
            </form>
          }
          testId="user-tab"
        >
          {usersLoading ? (
            <Skeleton className="h-[16rem]" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]" data-testid="user-table">
                  <thead>
                    <tr style={{ color: 'var(--text-3)' }}>
                      <th className="py-1.5 text-left font-normal">ID</th>
                      <th className="py-1.5 text-left font-normal">邮箱</th>
                      <th className="py-1.5 text-left font-normal">昵称</th>
                      <th className="py-1.5 text-left font-normal">角色</th>
                      <th className="py-1.5 text-left font-normal">状态</th>
                      <th className="py-1.5 text-left font-normal">最近登录</th>
                      <th className="py-1.5 text-right font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr
                        key={u.id}
                        style={{ borderTop: '1px solid var(--border)', opacity: u.status === 1 ? 1 : 0.62 }}
                        data-testid={`user-row-${u.id}`}
                      >
                        <td className="py-2 tabular-nums" style={{ color: 'var(--text-3)' }}>
                          {u.id}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-1)' }}>
                          {u.email}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-2)' }}>
                          {u.nickname ?? '—'}
                        </td>
                        <td className="py-2">
                          <span
                            className="rounded-full px-2 py-0.5 text-[0.6875rem]"
                            style={{
                              background:
                                u.role === 'admin' ? 'var(--primary)' : 'var(--surface-2)',
                              color: u.role === 'admin' ? 'var(--primary-fg)' : 'var(--text-2)',
                            }}
                          >
                            {ROLE_LABEL[u.role] ?? u.role}
                          </span>
                        </td>
                        <td className="py-2">
                          <span
                            className="rounded-full px-2 py-0.5 text-[0.6875rem]"
                            style={{
                              background: u.status === 1 ? 'var(--success-soft)' : 'var(--surface-2)',
                              color: u.status === 1 ? 'var(--success)' : 'var(--text-3)',
                            }}
                            data-testid={`user-status-${u.id}`}
                          >
                            {u.status === 1 ? '启用中' : '已停用'}
                          </span>
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-3)' }}>
                          {u.last_login_at ?? '从未登录'}
                        </td>
                        <td className="py-2">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              className="rounded-[var(--radius-md)] px-2.5 py-1 text-[0.75rem]"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                              disabled={busy}
                              data-testid={`toggle-${u.id}`}
                              onClick={() => void toggleStatus(u)}
                            >
                              {u.status === 1 ? '停用' : '启用'}
                            </button>
                            <button
                              type="button"
                              className="rounded-[var(--radius-md)] px-2.5 py-1 text-[0.75rem]"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                              disabled={busy}
                              data-testid={`role-${u.id}`}
                              onClick={() => void toggleRole(u)}
                            >
                              {u.role === 'admin' ? '降为用户' : '升为管理员'}
                            </button>
                            <button
                              type="button"
                              className="rounded-[var(--radius-md)] px-2.5 py-1 text-[0.75rem]"
                              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                              disabled={busy}
                              data-testid={`reset-${u.id}`}
                              onClick={() => {
                                setResetTarget(u);
                                setNewPwd('');
                              }}
                            >
                              重置密码
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {users.length === 0 && (
                <p className="py-8 text-center text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
                  没有符合条件的用户
                </p>
              )}
              {userPages > 1 && (
                <Pager page={userPage} pages={userPages} onChange={setUserPage} />
              )}
            </>
          )}
        </Card>
      )}

      {/* ==================== 任务管理 ==================== */}
      {tab === 'tasks' && (
        <Card
          title={`任务管理（${taskTotal}）`}
          actions={
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setTaskPage(1);
                setTaskQuery({
                  ...(taskDraft.q ? { q: taskDraft.q } : {}),
                });
              }}
            >
              <input
                value={taskDraft.q}
                onChange={(e) => setTaskDraft((d) => ({ ...d, q: e.target.value }))}
                placeholder="按任务名搜索"
                className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-[0.8125rem]"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                  width: '11rem',
                }}
                data-testid="task-search"
              />
              <select
                value={taskQuery.status ?? ''}
                onChange={(e) => {
                  const v = e.target.value as '' | TaskStatus;
                  setTaskPage(1);
                  setTaskQuery((q) => ({ ...q, status: v || undefined }));
                }}
                className="rounded-[var(--radius-md)] px-2 py-1.5 text-[0.8125rem]"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-1)',
                }}
                data-testid="task-status-filter"
              >
                <option value="">全部状态</option>
                {(['created', 'running', 'succeeded', 'failed'] as const).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </form>
          }
          testId="task-tab"
        >
          {tasksLoading ? (
            <Skeleton className="h-[16rem]" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]" data-testid="task-table">
                  <thead>
                    <tr style={{ color: 'var(--text-3)' }}>
                      <th className="py-1.5 text-left font-normal">ID</th>
                      <th className="py-1.5 text-left font-normal">任务名</th>
                      <th className="py-1.5 text-left font-normal">归属用户</th>
                      <th className="py-1.5 text-left font-normal">状态</th>
                      <th className="py-1.5 text-right font-normal">步长</th>
                      <th className="py-1.5 text-right font-normal">MAPE</th>
                      <th className="py-1.5 text-right font-normal">耗时</th>
                      <th className="py-1.5 text-right font-normal">创建时间</th>
                      <th className="py-1.5 text-right font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr
                        key={t.id}
                        style={{
                          borderTop: '1px solid var(--border)',
                          opacity: t.is_deleted === 1 ? 0.55 : 1,
                        }}
                        data-testid={`task-row-${t.id}`}
                      >
                        <td className="py-2 tabular-nums" style={{ color: 'var(--text-3)' }}>
                          {t.id}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-1)' }}>
                          {t.task_name}
                          {/* 🔒 已软删除的也要显示出来（管理端是运维视角），
                              但要让管理员一眼看出「用户已经删过了」 */}
                          {t.is_deleted === 1 && (
                            <span
                              className="ml-1.5 rounded-full px-1.5 py-0.5 text-[0.625rem]"
                              style={{
                                background: 'var(--surface-2)',
                                color: 'var(--text-3)',
                                textDecoration: 'line-through',
                              }}
                              data-testid={`soft-deleted-${t.id}`}
                            >
                              用户已删除
                            </span>
                          )}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-2)' }}>
                          {t.owner_email}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-2)' }}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </td>
                        <td className="py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>
                          {t.horizon} 天
                        </td>
                        <td
                          className="py-2 text-right tabular-nums"
                          style={{ color: 'var(--text-2)' }}
                        >
                          {/* 🔒 失败任务显示「—」而不是 0（`UX-P09-03` 同源纪律） */}
                          {t.weighted_mape !== null ? `${t.weighted_mape}%` : '—'}
                        </td>
                        <td
                          className="py-2 text-right tabular-nums"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {t.duration_ms ? `${(t.duration_ms / 1000).toFixed(1)} s` : '—'}
                        </td>
                        <td className="py-2 text-right" style={{ color: 'var(--text-3)' }}>
                          {t.created_at}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            className="rounded-[var(--radius-md)] px-2.5 py-1 text-[0.75rem]"
                            style={{ background: 'var(--danger-soft)', color: 'var(--on-danger-soft)' }}
                            disabled={busy}
                            data-testid={`force-del-${t.id}`}
                            onClick={() => {
                              setDelTarget(t);
                              setTypedId('');
                            }}
                          >
                            强制删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tasks.length === 0 && (
                <p className="py-8 text-center text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
                  没有符合条件的任务
                </p>
              )}
              {taskPages > 1 && (
                <Pager page={taskPage} pages={taskPages} onChange={setTaskPage} />
              )}
            </>
          )}
        </Card>
      )}

      {/* ==================== 操作日志 ==================== */}
      {tab === 'logs' && (
        <Card
          title={`操作日志（${logTotal}）`}
          actions={
            <select
              value={logQuery.action ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setLogPage(1);
                setLogQuery(v ? { action: v } : {});
              }}
              className="rounded-[var(--radius-md)] px-2 py-1.5 text-[0.8125rem]"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              data-testid="log-action-filter"
            >
              <option value="">全部动作</option>
              {Object.keys(ACTION_LABEL).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          }
          testId="log-tab"
        >
          {logsLoading ? (
            <Skeleton className="h-[16rem]" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]" data-testid="log-table">
                  <thead>
                    <tr style={{ color: 'var(--text-3)' }}>
                      <th className="py-1.5 text-left font-normal">时间</th>
                      <th className="py-1.5 text-left font-normal">动作</th>
                      <th className="py-1.5 text-left font-normal">子动作</th>
                      <th className="py-1.5 text-left font-normal">操作者</th>
                      <th className="py-1.5 text-left font-normal">目标</th>
                      <th className="py-1.5 text-left font-normal">结果</th>
                      <th className="py-1.5 text-left font-normal">明细</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr
                        key={l.id}
                        style={{ borderTop: '1px solid var(--border)' }}
                        data-testid={`log-row-${l.id}`}
                      >
                        <td className="py-2 tabular-nums" style={{ color: 'var(--text-3)' }}>
                          {l.created_at}
                        </td>
                        <td className="py-2" style={{ color: 'var(--text-1)' }}>
                          {ACTION_LABEL[l.action] ?? l.action}
                        </td>
                        <td className="py-2">
                          {l.sub_action ? (
                            <span
                              className="rounded-full px-2 py-0.5 text-[0.6875rem]"
                              style={{
                                background: 'var(--primary)',
                                color: 'var(--primary-fg)',
                              }}
                            >
                              {SUB_LABEL[l.sub_action] ?? l.sub_action}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-3)' }}>—</span>
                          )}
                        </td>
                        <td className="py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>
                          {l.operator_id ?? l.user_id ?? '—'}
                        </td>
                        <td className="py-2 tabular-nums" style={{ color: 'var(--text-2)' }}>
                          {l.target_id ?? '—'}
                        </td>
                        <td className="py-2">
                          <span
                            className="rounded-full px-2 py-0.5 text-[0.6875rem]"
                            style={{
                              background:
                                l.result === 'success'
                                  ? 'var(--success-soft)'
                                  : 'var(--danger-soft)',
                              color: l.result === 'success' ? 'var(--success)' : 'var(--danger)',
                            }}
                          >
                            {l.result === 'success' ? '成功' : '失败'}
                          </span>
                        </td>
                        {/* 🔒 子动作已由后端结构化拆好（`sub_action`），
                            明细列仍展示原始 detail 便于排查 */}
                        <td
                          className="py-2 font-mono text-[0.6875rem]"
                          style={{ color: 'var(--text-3)' }}
                        >
                          {l.detail ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {logs.length === 0 && (
                <p className="py-8 text-center text-[0.8125rem]" style={{ color: 'var(--text-3)' }}>
                  没有符合条件的日志记录
                </p>
              )}
              {logPages > 1 && (
                <Pager page={logPage} pages={logPages} onChange={setLogPage} />
              )}
            </>
          )}
        </Card>
      )}

      {/* ==================== 重置密码弹窗 ==================== */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.45)' }}
          role="dialog"
          aria-modal="true"
          data-testid="reset-dialog"
        >
          <div
            className="w-full max-w-md rounded-[var(--radius)] border p-5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-[1.0625rem] font-semibold" style={{ color: 'var(--text-1)' }}>
              重置 {resetTarget.email} 的密码
            </h2>
            <div className="mt-3">
              {/* 🔒 文案必须说清两件事：旧密码作废 + 旧登录态立即失效 */}
              <NoticeBar variant="warning" title="此操作不可撤销">
                新密码设置后，<b>原密码立即作废</b>；
                同时该用户的<b>全部已登录会话会立刻失效</b>（需重新登录）。
                请通过安全渠道把新密码告知本人。
              </NoticeBar>
            </div>
            <label
              className="mt-3 block text-[0.8125rem]"
              style={{ color: 'var(--text-2)' }}
              htmlFor="new-pwd"
            >
              新密码（不少于 8 位，需同时包含字母与数字）
            </label>
            <input
              id="new-pwd"
              type="text"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="mt-1.5 w-full rounded-[var(--radius-md)] px-2.5 py-2 text-[0.8125rem]"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              data-testid="reset-input"
            />
            {/* 🔒 实时给强度反馈：规则与后端 `ResetPasswordRequest` 同源 */}
            <p
              className="mt-1.5 text-[0.75rem]"
              style={{ color: pwdOk ? 'var(--success)' : 'var(--text-3)' }}
              data-testid="pwd-hint"
            >
              {newPwd.length === 0
                ? '尚未输入'
                : pwdOk
                  ? '✓ 满足强度要求'
                  : '需不少于 8 位，且同时包含字母与数字'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem]"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                onClick={() => setResetTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem]"
                // 🔒 `disabled` 与底色必须共用同一判据 `pwdOk`（`D-10`）
                disabled={busy || !pwdOk}
                style={{
                  background: busy || !pwdOk ? 'var(--surface-2)' : 'var(--danger)',
                  color: busy || !pwdOk ? 'var(--text-3)' : 'var(--danger-fg)',
                }}
                data-testid="reset-confirm"
                onClick={() => void doReset()}
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 强制删除二次确认 ==================== */}
      {delTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.45)' }}
          role="dialog"
          aria-modal="true"
          data-testid="force-del-dialog"
        >
          <div
            className="w-full max-w-md rounded-[var(--radius)] border p-5"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            <h2 className="text-[1.0625rem] font-semibold" style={{ color: 'var(--text-1)' }}>
              强制删除任务 #{delTarget.id}
            </h2>
            <div className="mt-3">
              {/* 🔴 文案必须与用户侧软删除明确区分：
                  用户侧写「可恢复」，这里必须写「不可恢复」并说清连带删什么 */}
              <NoticeBar variant="danger" title="此操作不可恢复">
                将<b>物理删除</b>该任务，同时删除其
                <b>全部预测明细与指标</b>，数据无法找回。
                <br />
                <strong>这与用户在历史列表里的「删除」不同</strong>
                ——用户侧是软删除（数据仍可由管理员查回），此处的强制删除不可恢复。
                <br />
                <strong>若只是想清理用户的列表视图，请让用户自行删除，无需强制删除。</strong>
              </NoticeBar>
            </div>
            <p className="mt-3 text-[0.8125rem]" style={{ color: 'var(--text-2)' }}>
              请输入任务 ID <code style={{ color: 'var(--text-1)' }}>{delTarget.id}</code>{' '}
              以确认：
            </p>
            <input
              value={typedId}
              onChange={(e) => setTypedId(e.target.value)}
              className="mt-1.5 w-full rounded-[var(--radius-md)] px-2.5 py-2 text-[0.8125rem]"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-1)',
              }}
              data-testid="force-del-input"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem]"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                onClick={() => setDelTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-[0.8125rem]"
                disabled={busy || typedId.trim() !== String(delTarget.id)}
                style={{
                  background:
                    busy || typedId.trim() !== String(delTarget.id)
                      ? 'var(--surface-2)'
                      : 'var(--danger)',
                  color:
                    busy || typedId.trim() !== String(delTarget.id)
                      ? 'var(--text-3)'
                      : 'var(--danger-fg)',
                }}
                data-testid="force-del-confirm"
                onClick={() => void doDelete()}
              >
                永久删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div
      className="mt-3 flex items-center justify-end gap-2 text-[0.8125rem]"
      style={{ color: 'var(--text-3)' }}
    >
      <button
        type="button"
        className="rounded-[var(--radius-md)] px-2.5 py-1"
        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </button>
      <span className="tabular-nums" data-testid="pager">
        {page} / {pages}
      </span>
      <button
        type="button"
        className="rounded-[var(--radius-md)] px-2.5 py-1"
        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}
