# 猫屿 CAT ISLE · 猫咖官网（FastAPI + React）

> 在猫的节奏里，慢下来 —— 城市中的治愈角落

单店猫咖官网，含**前台展示系统**与**后台管理系统**，FastAPI + React + SQLite 全栈实现。

## 仓库结构

```
├── docs/                    # 项目文档（PRD / UIUX / 开发技术文档 / 数据库设计文档 / 实施方案 / 架构图）
├── prototypes/              # 高保真原型（前台首页 / 后台管理）
├── cat-isle-backend/        # FastAPI 后端（M2 完成，pytest 22/22 通过）
└── frontend/                # React 前端（M3 开发中，尚未提交）
```

## 文档链

| 文档 | 说明 |
| --- | --- |
| `docs/猫屿猫咖官网PRD.md` | 产品需求文档 V1.2（功能/业务流程/验收标准） |
| `docs/猫屿UIUX设计文档.md` | UI/UX 设计规范 V1.0（设计系统/组件/页面/无障碍） |
| `docs/猫屿开发技术文档.md` | 开发技术文档 V1.2（架构/接口/部署） |
| `docs/猫屿数据库设计文档.md` | 数据库设计 V1.1（ER 图/数据字典/建表 SQL） |
| `docs/猫屿开发实施方案.md` | 项目开发实施方案（M2→M3→M4 阶段计划） |

## 后端快速启动

```bash
cd cat-isle-backend
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash
pip install -r requirements.txt
cp .env.example .env        # 修改 JWT_SECRET / ADMIN_PASSWORD
python -m app.seed          # 建表 + 种子 + 部分唯一索引
uvicorn app.main:app --reload --port 8000   # 生产必须 --workers 1
```

- Swagger 文档：http://localhost:8000/docs
- 测试：`.venv/Scripts/python.exe -m pytest tests -v`（22 用例）

## 开发进度

- [x] M1 设计定稿（文档 + 原型）
- [x] M2 后端开发（37/37 接口，pytest 22/22，Uvicorn 冒烟通过）
- [x] M3 前端开发（前台 7 页 + 后台 8 模块，构建通过，前后端代理联调通过）
- [x] M4 联调上线（单端口 SPA 托管 + 端到端 23 断言 + PRD §11 十一项验收通过 + 部署配置齐备）
- [ ] 正式上线（等待：猫咪实拍 / 真实菜单 / 微信收款码 / 服务器+备案域名）

## 前端快速启动

```bash
cd frontend
npm install          # 依赖（.npmrc 已配置国内镜像）
npm run dev          # 开发：http://localhost:5173（/api 代理到 8000）
npm run build        # 构建：产物 dist/（复制到 cat-isle-backend/static/ 后单端口运行）
```

## 单端口联调 / 部署预览（M4）

```bash
cd cat-isle-backend
# 前端产物已复制到 static/（重新构建后：cp -r ../frontend/dist/* static/）
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
# 访问 http://localhost:8000（前端 + API 同端口）
# 验收脚本：scripts/e2e_smoke.py（23 断言）、scripts/verify_prd.py（5 断言），报告见 docs/猫屿验收报告.md
```

## 部署（deploy/ 目录）

- `deploy/nginx.conf`：反代 + HTTPS（certbot）+ gzip 示例
- `deploy/catisle.service`：systemd 单元（单 worker，防定时任务重复）
- `deploy/backup.sh`：每日数据库热备 + uploads 打包（保留 14 天）
- `deploy/上线检查清单.md`：服务器/HTTPS/数据初始化/功能回归/运维逐项打勾
