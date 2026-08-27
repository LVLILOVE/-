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
- [ ] M3 前端开发（React）
- [ ] M4 联调上线
