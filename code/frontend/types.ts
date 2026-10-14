/**
 * =============================================================================
 * 电商销量预测系统 · 前端类型定义
 * -----------------------------------------------------------------------------
 * 版本     : V1.0
 * 依据文档 : 《开发技术文档 V1.0》第 5 章（接口设计）、第 6 章（前端设计）
 * 对应后端 : code/backend/schemas.py（Pydantic 模型，字段逐一对应）
 * 数据库   : code/db/schema.sql
 * -----------------------------------------------------------------------------
 * 命名约定（重要）：
 *   1. 全链路统一 snake_case —— 数据库字段、Pydantic 模型、HTTP JSON、
 *      前端 TS 类型**四处同名**，不做大小写转换。理由：消除转换层，
 *      避免 actualValue / actual_value 这类拼写漂移导致的静默 bug。
 *   2. 例外：原型 assets/demo-data.js 里的 REAL_EVAL 常量使用 camelCase
 *      （weightedMape 等），那是原型内嵌演示数据，**不是接口契约**。
 *      实现时以本文件为准，原型该常量按 UX-GOV-01 予以移除。
 * =============================================================================
 */

/* =============================================================================
 * 1. 基础枚举与字面量
 * ========================================================================== */

/** 建模层级：决定置信度与指标统计口径（PRD §3.3 FR-FEA-09） */
export type GranularityLevel = 'L1' | 'L2' | 'L3';

/**
 * L1 高置信（历史充足，走 LSTM 推理）
 * L2 中置信（历史偏短，商品级降级分摊）
 * L3 低置信（不可预测，不输出数值，仅历史均值）
 */
export const GRANULARITY_META: Record<
  GranularityLevel,
  { label: string; confidence: string; predictable: boolean }
> = {
  L1: { label: '模型预测', confidence: '高', predictable: true },
  L2: { label: '商品级降级', confidence: '中', predictable: true },
  L3: { label: '不可预测', confidence: '低', predictable: false },
};

/** 任务状态机（开发方案 §2.3，已去掉 queued 态） */
export type TaskStatus = 'created' | 'running' | 'succeeded' | 'failed';

/**
 * 业务错误码（PRD FR-SYS-02）
 * 区间：400xx 请求/校验 · 401xx 认证 · 403xx 权限 · 404xx 不存在 · 500xx 内部
 */
export type ErrorCode = number;

export const ERR = {
  OK: 0,

  // 400xx 请求与数据校验
  MISSING_COLUMN: 40001,      // 缺少必需列
  DATE_UNPARSABLE: 40002,     // 日期无法解析
  NEGATIVE_VALUE: 40003,      // 销量存在负值
  SERIES_OVER_LIMIT: 40004,   // 序列数超上限
  DATE_GAP: 40005,            // 时间序列断档
  INSUFFICIENT_DATA: 40006,   // 数据量不足以预测
  FILE_TOO_LARGE: 40007,      // 文件超 20MB
  ROW_OVER_LIMIT: 40008,      // 行数超 50 万
  BAD_EXTENSION: 40009,       // 扩展名非 .csv
  EMPTY_FILE: 40010,          // 空文件
  WEAK_PASSWORD: 40011,       // 密码强度不足
  BAD_PARAM: 40012,           // 参数非法（horizon 等）

  // 401xx 认证
  UNAUTHORIZED: 40101,        // 未登录
  TOKEN_EXPIRED: 40102,       // Token 失效
  BAD_CREDENTIAL: 40103,      // 邮箱或密码错误
  LOGIN_LOCKED: 40104,        // 限流冷却中
  EMAIL_TAKEN: 40105,         // 邮箱已注册

  // 403xx 权限
  FORBIDDEN: 40301,           // 无权访问他人资源

  // 404xx 不存在
  TASK_NOT_FOUND: 40401,
  DATASET_NOT_FOUND: 40402,
  USER_NOT_FOUND: 40403,
  MODEL_NOT_READY: 40404,     // 无启用模型版本

  // 500xx 内部
  INFER_FAIL: 50001,          // 模型推理失败
  IO_ERROR: 50002,            // 文件读写异常
  DB_ERROR: 50003,
} as const;

/** 任务级失败原因码（写入 tasks.error_code） */
export type TaskErrorCode = 'E_TIMEOUT' | 'E_TOO_MANY_SERIES' | 'E_INFER_FAIL';

/** 流水线阶段标识（执行进度页五阶段） */
export type PipelineStage =
  | 'validate'
  | 'preprocess'
  | 'features'
  | 'inference'
  | 'metrics';

export const STAGE_LABELS: Record<PipelineStage, string> = {
  validate: '读取校验',
  preprocess: '预处理',
  features: '特征工程',
  inference: '模型推理',
  metrics: '指标计算',
};

/* =============================================================================
 * 2. 通用响应包装（PRD FR-SYS-01：所有接口结构一致）
 * ========================================================================== */

export interface ApiResponse<T> {
  code: ErrorCode;
  message: string;
  data: T;
}

/** 校验类错误的 data 载荷：必须给出「错在哪 + 怎么改」（NFR-USE-03） */
export interface ValidationErrorData {
  fail_stage: string;
  missing_columns?: string[];
  unparsable_rows?: Array<{ row_no: number; raw_value: string; column: string }>;
  negative_rows?: Array<{ row_no: number; value: number }>;
  gap_ranges?: Array<{
    sku_id: string;
    warehouse_id: string;
    gap_start: string;
    gap_end: string;
    gap_days: number;
  }>;
  series_count?: number;
  series_limit?: number;
  suggestion: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

/* =============================================================================
 * 3. 认证与用户                                            API-01 ~ API-05
 * ========================================================================== */

export interface RegisterRequest {
  email: string;
  password: string;
  nickname?: string;
}

export interface RegisterResponse {
  user_id: number;
  email: string;
}

/**
 * JWT 载荷结构（BE-19 / TQ-1 决议）。
 *
 * 该结构不在接口响应中传输（Token 是不透明串），但它是后端签发、前端排障时
 * 解 Token 的共同契约。`ver` 必须与 `users.token_version` 一致，不一致即代表
 * 该 Token 已被撤回（改密场景，`FR-USR-07`）。
 */
export interface JwtPayload {
  sub: string;   // 用户 id 的字符串形式（JWT 规范要求 sub 为字符串）
  ver: number;   // 签发时的 token_version 快照
  jti: string;   // Token 唯一标识，登出时写入内存黑名单
  iat: number;   // 签发时间（Unix 秒）
  exp: number;   // 过期时间（Unix 秒）
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;          // 秒
  user: UserProfile;
}

export interface UserProfile {
  id: number;
  email: string;
  nickname: string | null;
  status: 0 | 1;
  /**
   * CH-01：角色。前端据此派生 `isAdmin`，决定是否显示管理端导航入口。
   * ⚠️ 这是「自我描述」而非权限凭证 —— 真正的越权判定在服务端
   *    `get_current_admin`，前端不得仅凭本字段放行管理端操作。
   */
  role: UserRole;
  last_login_at: string | null;
  created_at: string;
}

/** 用户角色（CH-01）。本期只有两种，不含多角色 RBAC。 */
export type UserRole = 'user' | 'admin';

export const ROLE = {
  USER: 'user',
  ADMIN: 'admin',
} as const satisfies Record<string, UserRole>;

export interface UpdateUserRequest {
  nickname?: string;
  old_password?: string;
  new_password?: string;
}

/* =============================================================================
 * 4. 数据集                                               API-06 ~ API-11
 * ========================================================================== */

export interface DatasetSummary {
  id: number;
  file_name: string;
  file_size: number;               // 字节
  row_count: number;
  sku_count: number;
  warehouse_count: number;
  valid_series_count: number;
  date_start: string;              // YYYY-MM-DD
  date_end: string;
  gap_filled: 0 | 1;
  gap_count: number;
  is_sample: 0 | 1;
  status: 1 | -1;
  created_at: string;
}

/** 上传成功响应：同时给出概要、预览与待预测序列数 */
export interface UploadDatasetResponse {
  dataset: DatasetSummary;
  preview: DatasetPreview;
  series_count: number;
  series_limit: number;            // 1000
  gap_warning: {
    has_gap: boolean;
    gap_count: number;
    ranges: ValidationErrorData['gap_ranges'];
    interpolated: boolean;
  };
}

export interface DatasetPreview {
  columns: string[];               // ['sku_id','warehouse_id','date','sales']
  rows: Array<Record<string, string | number>>;
  total: number;                   // 总行数
  shown: number;                   // 本次返回行数
}

/** 断档确认：FR-UPL-13 要求用户显式选择，不得自动继续 */
export interface ResolveGapRequest {
  dataset_id: number;
  action: 'interpolate' | 'abort';
}

/* =============================================================================
 * 5. 预测任务                                             API-12 ~ API-15
 * ========================================================================== */

export interface CreateTaskRequest {
  dataset_id: number;
  /** 固定 'warehouse_sku'，仅作显式声明，后端校验取值 */
  granularity: 'warehouse_sku';
  horizon: 7 | 14 | 30;
  use_holiday_feature?: 0 | 1;
  task_name?: string;
}

/** 创建即返回任务骨架（同步执行，无排队态） */
export interface CreateTaskResponse {
  task_id: number;
  status: TaskStatus;
  model_version: string;
  series_count: number;
  /** 前端据此决定进度条刻度与耗时预估 */
  estimated_ms: number;
}

export interface TaskStatusResponse {
  task_id: number;
  status: TaskStatus;
  stage: PipelineStage | null;
  stage_index: number;             // 1..5
  stage_total: 5;
  progress_pct: number;            // 0..100
  device: 'cuda' | 'cpu' | null;
  device_fallback: 0 | 1;
  elapsed_ms: number;
  budget_ms: number;               // 60000
  series_count: number;
  l1_count: number | null;
  l2_count: number | null;
  l3_count: number | null;
  error_code: TaskErrorCode | null;
  error_msg: string | null;
  completed_stage: PipelineStage | null;
}

/* =============================================================================
 * 6. 预测结果                                             API-14
 * ========================================================================== */

/**
 * 指标集合：字段与 outputs/eval_report.json 的 metrics 段一一对应，
 * 保证「文档口径 = 算法产出 = 接口返回」三者同源。
 */
export interface MetricBundle {
  weighted_mape: number;           // 硬指标 <= 20
  weighted_mae: number;
  weighted_rmse: number;
  baseline_mape: number | null;
  baseline_mae: number;
  baseline_rmse: number;
  mae_improve_pct: number;         // 硬指标 >= 15
  rmse_improve_pct: number;        // 硬指标 >= 15
  series_evaluated: number;
  series_passed: number;
  series_pass_rate: number;        // 辅助指标 >= 60
  l1_mape: number | null;
  l2_mape: number | null;          // 常为 null：L2 在测试段缺真值
}

/** 覆盖率披露：三项之和必须等于 total（UI/UX UX-AC-06） */
export interface Coverage {
  L1: number;
  L2: number;
  L3: number;
  total: number;
  L1_pct: number;
  L2_pct: number;
  L3_pct: number;
  predictable: number;
  predictable_pct: number;
}

/** 逐序列 MAPE 分布（直方图，分箱 <= 20） */
export interface Distribution {
  median: number;
  p75: number;
  p90: number;
  max: number;
  over_count: number;              // 超过阈值的序列数
  threshold: number;               // 20
  buckets?: number[];
}

/** 分阶段耗时，用于执行进度页时间轴与详情页耗时拆解 */
export interface TimingMs {
  preprocess_ms: number;
  features_ms: number;
  inference_ms: number;
  metrics_ms: number;
  total_ms: number;
}

/** 单条序列的曲线数据（结果页折线图与明细表的数据源） */
export interface SeriesCurve {
  key: string;                     // `${sku_id}-${warehouse_id}`
  sku_id: string;
  warehouse_id: string;
  granularity_level: GranularityLevel;
  mape: number | null;
  passed: boolean;
  /** 预测段日期（长度 = horizon） */
  forecast_dates: string[];
  /** 预测值 */
  predicted: number[];
  /** 真值（回测时有，生产环境为 null） */
  actual: number[] | null;
  /** 移动平均基线值 */
  baseline: number[];
  /** 历史段日期（用于折线图左侧实线段） */
  history_dates: string[];
  /** 历史段销量 */
  history_sales: number[];
}

/** 明细表单行（分页接口返回） */
export interface PredictionRow {
  sku_id: string;
  warehouse_id: string;
  forecast_date: string;
  predicted_value: number;
  actual_value: number | null;
  baseline_value: number | null;
  granularity_level: GranularityLevel;
  error: number | null;            // |actual - predicted|，无真值时为 null
  error_pct: number | null;
}

/** GET /predictions/{task_id} 响应 */
export interface PredictionResultResponse {
  task: {
    id: number;
    task_name: string | null;
    status: TaskStatus;
    horizon: 7 | 14 | 30;
    granularity: 'warehouse_sku';
    model_version: string;
    device: 'cuda' | 'cpu';
    device_fallback: 0 | 1;
    series_total: number;
    duration_ms: number;
    created_at: string;
    finished_at: string;
  };
  dataset: {
    id: number;
    file_name: string;
    row_count: number;
    sku_count: number;
    warehouse_count: number;
    date_start: string;
    date_end: string;
  };
  metrics: MetricBundle;
  coverage: Coverage;
  distribution: Distribution;
  timing_ms: TimingMs;
  /** 是否超标，驱动前端不可折叠的警告（FR-VIS-06） */
  is_over_threshold: boolean;
  /** 评估前提，必须原样展示（FR-MOD-13） */
  eval_note: string;
  /** 曲线数据；序列过多时按 need_curves 决定是否内联 */
  series: SeriesCurve[];
  /** 明细表分页游标：明细走独立分页接口，避免单响应过大 */
  detail_total: number;
}

/** GET /predictions/{task_id}/detail 明细分页（结果页表格用） */
export interface PredictionDetailQuery {
  page?: number;
  size?: number;                   // 默认 20
  sort_by?: keyof PredictionRow;
  order?: 'asc' | 'desc';
  level?: GranularityLevel;        // 按分级过滤
  keyword?: string;                // 商品 / 仓库模糊搜索
}

/* =============================================================================
 * 7. 历史与对比                                           API-16 ~ API-19
 * ========================================================================== */

export interface HistoryQuery {
  page?: number;
  size?: number;                   // 默认 20
  keyword?: string;
  date_from?: string;
  date_to?: string;
  status?: TaskStatus;
}

/** 历史列表项（对应数据库视图 v_task_summary） */
export interface HistoryItem {
  task_id: number;
  task_name: string | null;
  status: TaskStatus;
  granularity: 'warehouse_sku';
  horizon: 7 | 14 | 30;
  dataset_name: string;
  series_total: number;
  duration_ms: number | null;
  device: 'cuda' | 'cpu' | null;
  device_fallback: 0 | 1;
  model_version: string;
  weighted_mape: number | null;
  weighted_mae: number | null;
  weighted_rmse: number | null;
  mae_improve_pct: number | null;
  rmse_improve_pct: number | null;
  series_pass_rate: number | null;
  is_over_threshold: number | null;
  error_code: TaskErrorCode | null;
  created_at: string;
  finished_at: string | null;
}

/** 跨任务对比请求：2~4 个任务 */
export interface CompareRequest {
  task_ids: number[];              // 长度 2..4
  /** 叠加曲线的商品筛选，空表示取全部 */
  sku_ids?: string[];
  warehouse_ids?: string[];
}

export interface CompareTaskSlot {
  task_id: number;
  task_name: string | null;
  horizon: number;
  dataset_name: string;
  created_at: string;
  metrics: MetricBundle;
  coverage: Coverage;
  series: SeriesCurve[];
  /** 同组任务之间「不可直接比较」的原因（如数据文件不同） */
  warnings: string[];
}

export interface CompareResponse {
  tasks: CompareTaskSlot[];
  /** 差异归因：以第一条任务为基准的比较说明 */
  attribution: Array<{ task_id: number; note: string }>;
  /** 数据文件是否一致，不一致时前端须显著提示（原型已实现） */
  dataset_consistent: boolean;
}

/* =============================================================================
 * 8. 系统                                                API-20
 * ========================================================================== */

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  database: 'ok' | 'error';
  /** 模型是否已加载，未加载时服务仍可用但预测会失败 */
  model_loaded: boolean;
  model_version: string | null;
  device: 'cuda' | 'cpu' | null;
  uptime_seconds: number;
}

/* =============================================================================
 * 9. 前端侧常量（与后端 app/algo/config.py 保持一致，改动须同步）
 * ========================================================================== */

export const LIMITS = {
  max_file_size_mb: 20,
  max_rows: 500_000,
  max_series: 1000,
  sla_seconds: 60,
  l1_min_valid_points: 90,
  weighted_mape_limit: 20,
  baseline_improve_limit: 15,
  series_pass_rate_target: 60,
  allowed_horizons: [7, 14, 30] as const,

  /* --- 密码上限：两道限制缺一不可（JT-12，与后端 schemas.py 同源）--------- */
  /** 字符数上限。ASCII 场景下它先于字节上限触发 */
  password_max_chars: 64,
  /**
   * UTF-8 字节数上限。来自 bcrypt 的硬约束（bcrypt 5.x 超限直接抛 ValueError）。
   * 中文每字占 3 字节，24 个中文字符即触顶——故仅有字符上限是不够的。
   */
  password_max_bytes: 72,
} as const;

/**
 * 游客哨兵账号 ID（JT-10）。
 *
 * 未登录用户上传的数据集与创建的预测任务，其 user_id 记为 0。
 * 前端不需要主动使用该值（归属由后端写入），此处保留是为契约完整与排障可读：
 * 接口响应中出现 `user_id: 0` 属正常情况，不代表数据异常。
 */
export const GUEST_USER_ID = 0;

/**
 * JWT 版本号初始值（TQ-1 决议）。
 *
 * 必须与后端 `schemas.py::TOKEN_VERSION_DEFAULT` 及 DDL 中
 * `users.token_version DEFAULT 1` 三处同源。前端不参与签发与校验，
 * 此处保留仅为契约完整——排障时若解出的 `ver` 小于该值，说明 Token 来自旧库。
 */
export const TOKEN_VERSION_DEFAULT = 1;

/** 密码的 UTF-8 字节长度（`TextEncoder` 对 emoji 等多字节字符亦准确） */
export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

/**
 * 密码是否在 bcrypt 可处理范围内（JT-12）。
 *
 * 表单提交前调用可让用户立即看到提示，而不是提交后收到 422。
 * 判定逻辑必须与后端 `schemas.py::_enforce_bcrypt_bytes` 完全一致，
 * 否则会出现「前端放行、后端拒绝」的割裂。
 */
export function isPasswordWithinBcryptLimit(password: string): boolean {
  return passwordByteLength(password) <= LIMITS.password_max_bytes;
}

/** CSV 强制契约：列名不可改（PRD §3.2.2） */
export const REQUIRED_COLUMNS = ['sku_id', 'warehouse_id', 'date', 'sales'] as const;

/** 校验顺序不可调整，越靠前越快失败（PRD §3.2.2） */
export const VALIDATE_ORDER = [
  '扩展名',
  '大小/行数',
  '表头完整性',
  '日期可解析性',
  '销量非负',
  '时间连续性',
  '序列数上限',
] as const;

/** 导出列顺序固定（FR-VIS-05 / FR-HIS-03） */
export const EXPORT_COLUMNS = [
  'sku_id',
  'warehouse_id',
  'date',
  'forecast_sales',
  'granularity_level',
  'actual_sales',
  'error',
] as const;
