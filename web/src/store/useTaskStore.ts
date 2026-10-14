/**
 * 任务状态（useTaskStore）
 * -----------------------------------------------------------------------------
 * 职责：跨页传递「本次预测链路」的上下文 —— 上传页选定的数据集 → 参数页提交的任务
 *       → 执行页展示的执行结果。
 *
 * ⚠️ 为什么既用 store 又用 URL query：
 *   - URL query（`/params?datasetId=12`、`/running/7`）是**唯一可靠**的传递方式：
 *     刷新、分享、前进后退都不会丢，也是游客链路（未登录、无持久化）能跑通的前提。
 *   - store 只做「同一会话内的便利缓存」，供面包屑与**耗时明细**等
 *     「重放不了就拿不到」的载荷使用。
 *   因此页面的**真源是 query 参数 / 路由参数**，store 里的值缺失时不得当成错误
 *   （用户直接打开 `/running/7` 是合法入口，此时降级为只读 `API-13`）。
 *
 * 🔴 为什么 `lastTask` 必须存在于 store（EP-5 的关键设计约束）
 * -----------------------------------------------------------------------------
 * `API-12` 是**同步**语义：响应返回时任务已入终态。这意味着前端在任务运行期间
 * 拿不到 `task_id`，**没有任何可轮询的运行期窗口** → `API-13` 只能在事后补查
 * 权威字段，而它**不含分段耗时**。
 *
 * 而 `UX-P07-01` 要求时间轴「一眼看出哪一段最贵」，那必须有真实分段耗时。
 * 在 `EP-6` 的 `API-14`（结果接口，含 `timing_ms`）落地之前，这条数据只能由
 * `API-12` 的响应直接带过来。故参数页提交成功后把它写进 store，执行页优先读它。
 *
 * ⇒ 丢了 `lastTask` 不是错误，只是降级：执行页会明确显示「本次会话未持有耗时
 *    明细」并隐藏时间轴，而不是用估算值把图补齐（那正是 `QD-06` 禁止的「两套数字」）。
 */
import { create } from 'zustand';

import type { CreateTaskResponse } from '../types';

type TaskState = {
  /** 当前正在配置 / 执行的数据集 id（来自上传页的「下一步」） */
  datasetId: number | null;
  setDatasetId: (id: number | null) => void;

  /** 当前任务 id（EP-5 创建任务后写入） */
  activeTaskId: number | null;
  setActiveTaskId: (id: number | null) => void;

  /**
   * 最近一次 `API-12` 的完整响应（含 `timing` 分段耗时）。
   *
   * ⚠️ 只保留**最后一次**：它是「刚提交完那个任务」的上下文，不是任务缓存。
   *    按 task_id 建映射会让人误以为它是一个可查询的结果仓库，
   *    而真正的结果仓库是 `API-14`（`EP-6`）。
   */
  lastTask: CreateTaskResponse | null;
  setLastTask: (task: CreateTaskResponse | null) => void;
};

export const useTaskStore = create<TaskState>((set) => ({
  datasetId: null,
  setDatasetId: (id) => set({ datasetId: id }),

  activeTaskId: null,
  setActiveTaskId: (id) => set({ activeTaskId: id }),

  lastTask: null,
  setLastTask: (task) =>
    set({ lastTask: task, activeTaskId: task ? task.task_id : null }),
}));
