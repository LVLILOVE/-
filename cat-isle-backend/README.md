# 猫屿 CAT ISLE 后端（FastAPI · M2 开发版）

基于数据库设计文档 V1.1 的 8 张表与开发技术文档 V1.2 的全部接口实现（37/37）。pytest 22/22 通过，Uvicorn 冒烟验证通过。

## 快速启动

```bash
cd cat-isle-backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt                      # 国内网络建议加 -i https://pypi.tuna.tsinghua.edu.cn/simple
cp .env.example .env          # 修改 JWT_SECRET / ADMIN_PASSWORD
python -m app.seed            # 建表 + 种子数据 + 部分唯一索引（应用启动时也会自动执行）
uvicorn app.main:app --reload --port 8000            # 生产必须 --workers 1（内嵌定时任务）
```

- Swagger 文档：http://localhost:8000/docs
- 默认管理员：`.env` 中的 ADMIN_USERNAME / ADMIN_PASSWORD
- 运行测试：`.venv/Scripts/python.exe -m pytest tests -v`（使用独立测试库 test_catisle.db，自动清理）

## 目录结构

```
app/
├── main.py              # FastAPI 入口：路由注册 / 统一异常(40001 校验) / 定时任务 / 静态托管
├── models.py            # 8 张表 SQLAlchemy 模型（含 CHECK/索引；部分唯一索引见 seed）
├── schemas.py           # Pydantic 出入参（手机号正则校验）
├── seed.py              # 建表 + 种子（4 时段/押金/管理员）+ 部分唯一索引
├── core/
│   ├── config.py        # .env 配置
│   ├── db.py            # engine + WAL + foreign_keys 事件
│   ├── security.py      # bcrypt + JWT
│   ├── deps.py          # get_db / get_current_admin
│   └── response.py      # 统一响应 {code,msg,data} + BizError
├── routers/
│   ├── auth.py          # 登录（5 次锁定 15 分钟）/ me
│   ├── public.py        # 前台：cats/menu/slots/store/adopted-cats/公开上传
│   ├── reservations.py  # 预约：前台 4 接口 + 后台 3 接口（含余量总览）
│   ├── adoptions.py     # 领养：前台提交 + 后台审核流转/回访
│   └── admin.py         # 后台：cats/menu 管理 + settings/slots + stats + 上传
├── services/
│   └── reservation.py   # 核心：限流防超卖(BEGIN IMMEDIATE) / 状态机 / 超时扫描
└── tasks/
    └── scheduler.py     # APScheduler 定时任务（超时自动取消）
```

## 核心实现要点

- **防超卖**：`services/reservation.py::create_reservation` 用 `BEGIN IMMEDIATE` 获取写锁后 COUNT+插入
- **防重复**：`uq_res_phone_date` 部分唯一索引（phone+reserve_date，WHERE 过滤占用中 4 状态），由 `seed.py` 原生 SQL 创建（ORM 层**不声明**无条件唯一约束）
- **外键**：`core/db.py` 连接事件逐连接 `PRAGMA foreign_keys=ON`
- **校验统一**：Pydantic 校验失败经 `RequestValidationError` 处理器统一返回 40001
- **金额**：全程"分"整数；接口出入展示为元（÷100）

## 已验证（M2）

- [x] pytest 22/22 通过（认证 5 / 预约 8 / 领养 7 / 上传 2）
- [x] Uvicorn 冒烟：`/`、`/api/store`、`/api/slots`、`/docs` 正常
- [x] 关键场景：满员拒绝(40002) / 同日防重复(40003) / 店休(40004) / 取消后名额释放可再约 / 核验退回后可重提
- [x] 登录锁定(40102) / 未授权 401

## 待 M3/M4 补齐

- [ ] 管理员首次登录强制改密
- [ ] 前端 dist 构建产物接入 `static/`
- [ ] Nginx 部署配置（deploy/）
