-- =============================================================================
-- 电商销量预测系统 · 初始化数据脚本（seed）
-- -----------------------------------------------------------------------------
-- 版本     : V1.0（CH-01 增补：管理员种子账号）
-- 依据文档 : 《开发技术文档 V1.0》§3.6 初始化数据；《项目开发实施方案 V1.0》§5.3.3
-- 执行方式 : sqlite3 app.db < seed.sql      （需先执行 schema.sql）
-- 幂等性   : 是。全部使用 INSERT OR IGNORE / 唯一键去重
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- S0 · 游客哨兵账号（id = 0）
-- -----------------------------------------------------------------------------
-- 该行已在 schema.sql 中随建表脚本插入（它是外键完整性的结构前提，不属于
-- 「业务种子数据」）。此处重复一次仅为幂等保险：若有人只跑 schema.sql 之外
-- 的分支、或手工删过该行，重新执行 seed.sql 可修复。
-- 详见 schema.sql 中 T01a 段落，以及《开发技术文档 V1.0》§3.6 / JT-10。
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO users (id, email, password_hash, nickname, status)
VALUES (0, '__guest__@local.invalid', '!', '游客（未登录）', 1);

-- -----------------------------------------------------------------------------
-- S1 · 管理员种子账号（CH-01）
-- -----------------------------------------------------------------------------
-- 依据：《项目开发实施方案 V1.0》§5.3.3。管理端（AD-P01/AD-P02）需要一个
--       初始管理员账号，否则无人能进入 /admin。
--
-- 🔒 三条必须遵守的约束：
--   1. 邮箱域名**不得**使用 RFC 2606 保留域（.invalid / .local / .test）。
--      LoginRequest.email 的类型是 pydantic EmailStr，它会主动拒绝保留域，
--      请求在校验层就被拒 —— 管理员将永远无法登录。故这里用 .cn 真实域名。
--      （与游客哨兵相反：哨兵用 .invalid 是**刻意的防登录设计**，两者策略必然不同。）
--   2. password_hash 必须是真实 bcrypt 串，cost 因子与运行时一致（12）。
--      生成命令：
--        python -c "import bcrypt;print(bcrypt.hashpw(b'Admin@2026',bcrypt.gensalt(rounds=12)).decode())"
--   3. 明文密码须满足注册规则（FR-USR-02）：≥ 8 位、含字母与数字、≤ 72 字节。
--      本例为 'Admin@2026'。⚠️ 生产环境必须首次登录后立即修改。
--
-- 幂等性：ux_users_email 唯一索引 + INSERT OR IGNORE，重复执行不会报错，
--         也不会覆盖已修改过的密码。
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO users (email, password_hash, nickname, status, role)
VALUES (
    'admin@salesforecast.cn',
    '$2b$12$gHPiHYW9yCdlRjs8Ux2eme.EdryDZ44V9HbgR3.49dPAohfUmFLzS',  -- Admin@2026
    '系统管理员',
    1,
    'admin'
);

-- -----------------------------------------------------------------------------
-- S2 · model_registry：注册当前启用模型
-- -----------------------------------------------------------------------------
-- 以下数值全部取自真实训练产物 outputs/models/lstm_v1.report.json，
-- 不是占位值。复现方式：python scripts/train_and_register.py
-- 在线推理完全依赖本表，is_active = 1 的记录必须存在且唯一（FR-MOD-05）。
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO model_registry (
    version,
    file_path,
    window_size,
    hidden_size,
    num_layers,
    dropout,
    learning_rate,
    batch_size,
    train_data_range,
    train_row_count,
    series_count,
    val_mae,
    val_rmse,
    val_mape,
    device,
    peak_memory_mb,
    param_count,
    is_active,
    trained_at
) VALUES (
    'lstm_v1',
    'outputs/models/lstm_v1.pt',
    -- 生产配置，与 app/algo/config.py 一致
    -- 注意：不要与开发方案附录 D 的性能基准配置混淆
    --       （基准用 hidden=32 / layers=1 / window=14，仅用于压测对照）
    21,                     -- WINDOW_SIZE
    48,                     -- HIDDEN_SIZE
    2,                      -- NUM_LAYERS
    0.1,                    -- DROPOUT
    0.001,                  -- LR = 1e-3
    128,                    -- BATCH_SIZE
    '2015-01-28 ~ 2015-12-27',  -- 示例数据集时间范围（demo_sales.csv）
    14305,                  -- 训练数据行数（与 report.json 的 rows 一致）
    113,                    -- 序列数（L1 81 + L2 32 + L3 0）
    1.33,                   -- val_mae   加权口径
    3.06,                   -- val_rmse  加权口径
    14.07,                  -- val_mape  加权口径，阈值 <= 20
    'cuda',                 -- 实际训练设备（MX450，CUDA 12.9）
    111.0,                  -- 训练峰值显存 MB，实测值
    31729,                  -- 参数量，来自 report.json 的 train.n_params
    1,                      -- is_active = 1，全局唯一启用版本
    datetime('now', 'localtime')
);

-- -----------------------------------------------------------------------------
-- S3 · 演示账号（可选，仅本地开发环境使用）
-- -----------------------------------------------------------------------------
-- ⚠️ 生产环境必须删除本节，或改用一次性初始化接口创建。
-- password_hash 必须是真实 bcrypt 串，禁止写入明文或伪造串。
-- 生成方式：
--     python -c "import bcrypt;print(bcrypt.hashpw(b'Demo@12345',bcrypt.gensalt()).decode())"
-- 将输出串替换下面的 <BCRYPT_HASH_PLACEHOLDER> 后取消注释执行。
-- -----------------------------------------------------------------------------
-- INSERT OR IGNORE INTO users (email, password_hash, nickname, status)
-- VALUES (
--     'demo@example.com',
--     '<BCRYPT_HASH_PLACEHOLDER>',
--     '演示账号',
--     1
-- );

-- -----------------------------------------------------------------------------
-- S4 · 内置示例数据集的元信息
-- -----------------------------------------------------------------------------
-- 说明：示例数据按**当前调用者**惰性创建（is_sample = 1），不在种子阶段预置：
--       · 登录用户首次调用 GET /datasets/sample → 创建 user_id = 该用户 的记录
--       · 游客首次调用 → 创建 user_id = 0 的记录（游客哨兵，见 S0 与 JT-10）
--       重复调用返回已存在的那一条（幂等），故本节不写固定 INSERT。
--
-- 共享文件事实（供实现时核对）：
--   文件          : outputs/models/demo_sales.csv
--   表头          : sku_id,warehouse_id,date,sales
--   数据行数      : 14,305
--   商品数        : 40
--   仓库数        : 5（上海仓 / 广州仓 / 北京仓 / 成都仓 / 武汉仓）
--   序列数        : 113（L1 81 / L2 32 / L3 0）
--   时间范围      : 2015-01-28 ~ 2015-12-27
--   文件大小      : 约 479 KB
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- S5 · 自检：确认启用模型已注册
-- -----------------------------------------------------------------------------
-- 执行后可运行以下查询确认（应返回 1 行）：
--     SELECT version, hidden_size, num_layers, window_size, val_mape
--     FROM model_registry WHERE is_active = 1;
-- 确认管理员账号（应返回 1 行，role = 'admin'）：
--     SELECT id, email, role FROM users WHERE role = 'admin';
