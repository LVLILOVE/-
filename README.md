# 猫屿 CAT ISLE · 猫咖官网

> **在猫的节奏里，慢下来。**

猫屿是一家城市猫咖的线上门户：为顾客提供在线预约、猫咪档案、领养申请、店长解答等一站式服务，也为店长提供预约核验、押金管理、领养审核等后台管理能力。本项目由 **WorkBuddy AI 助手辅助开发**，覆盖需求分析、设计、编码、测试到验收交付的全流程。

![技术栈](https://img.shields.io/badge/FastAPI-3.x-009688) ![前端](https://img.shields.io/badge/React-19-61dafb) ![构建](https://img.shields.io/badge/Vite-8-646cff) ![样式](https://img.shields.io/badge/TailwindCSS-v4-38bdf8) ![数据库](https://img.shields.io/badge/SQLite-3-003b57) ![测试](https://img.shields.io/badge/pytest-28%20passed-green)

---

## ✨ 功能特性

### 前台（顾客端，免注册）
- **首页**：Hero 品牌区 · 猫屿的故事 · 猫咪预览 · 餐单预览 · 门店信息
- **猫咪**：猫咪档案卡片 +「今日店长」每日轮换展示位 + 可领养筛选
- **餐单**：分类 Tab（咖啡/茶饮/甜品/猫零食），餐品配图
- **预约**：在线选日期时段（4 时段 · 每时段限 6 组 · 周一店休自动置灰）→ 押金 ¥20 转账 → 提交凭证 → 店主核验
- **领养**：可领养猫咪展示 + 在线提交申请（四级审核 + 回访记录）
- **店长解答**：顾客提问 → 店长解答 → 新客查看（手机号仅店长可见）
- **猫屿小助手**：右下角对话式 FAQ，解答新客常见疑惑（纯前端）
- **关于我们**：品牌故事 · 门店信息 · 到店指南 · 联系我们

### 后台（店长端，单管理员）
- 仪表盘统计 · 猫咪管理 · 餐单管理 · 预约核验/押金管理 · 领养审核/回访 · **店长解答管理** · 门店设置 · 时段容量设置

## 🛠 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | FastAPI · SQLAlchemy · SQLite · JWT 鉴权 |
| 前端 | React 19 · Vite 8 · TypeScript · Tailwind CSS v4 · Zustand · React Router |
| 部署 | 单端口一体化（前端产物内置于后端 static/）· Uvicorn · Nginx（正式） |
| 测试 | pytest 28 项用例（预约/押金/领养/问答/鉴权） |

## 📁 项目结构

```
├── docs/                    # 项目文档（PRD/UIUX/技术文档/数据库设计/实施方案/验收报告等）
├── prototypes/              # 产品原型（前台首页 + 后台管理）
├── cat-isle-backend/        # FastAPI 后端
│   ├── app/                 #   models（9 表）/ routers（前台+后台 29 接口）/ services / core
│   ├── tests/               #   pytest 28 项用例
│   ├── scripts/             #   初始化与端到端验证脚本
│   └── static/              #   前端构建产物（一体化部署）
├── frontend/                # React 前端（Vite + TS + Tailwind）
│   ├── src/pages/           #   前台 9 页 + 后台 8 模块
│   ├── src/components/      #   公共组件（含猫屿小助手）
│   └── public/images/       #   本地图片资源
├── deploy/                  # Nginx / systemd / 备份脚本 / 上线检查清单
├── 验收材料/                # 演示 PPT / 截图素材 / 数据库脚本 / 源码快照 / 打包
└── 启动手册.md              # 本地运行与部署指南
```

## 🚀 快速开始

```bash
# 1) 后端依赖
cd cat-isle-backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt        # Windows
# .venv/bin/pip install -r requirements.txt          # macOS/Linux

# 2) 初始化数据库（含占位演示数据）
.venv/Scripts/python -m app.seed_demo

# 3) 启动（前端产物已内置 static/，单端口一体化）
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

访问 `http://127.0.0.1:8000`（前台）｜ `http://127.0.0.1:8000/admin`（后台，账号见 `.env`）

> 详细部署步骤见 `启动手册.md`；正式上线流程见 `deploy/上线检查清单.md`。

## 🗄 数据库脚本

- `验收材料/数据库脚本/catisle_schema.sql`：9 张表完整建表语句
- `验收材料/数据库脚本/catisle_seed_data.sql`：种子数据（管理员/时段/门店/猫咪/菜单/问答）

```bash
sqlite3 catisle.db < 验收材料/数据库脚本/catisle_schema.sql
sqlite3 catisle.db < 验收材料/数据库脚本/catisle_seed_data.sql
```

## 📄 项目文档

| 文档 | 说明 |
| --- | --- |
| `docs/猫屿猫咖官网PRD.md` | 12 章完整需求文档 |
| `docs/猫屿UIUX设计文档.md` | 设计系统与页面规范 |
| `docs/猫屿开发技术文档.md` | 技术架构与接口规范 |
| `docs/猫屿数据库设计文档.md` | 数据表设计与 ER 图 |
| `docs/猫屿开发实施方案.md` | M1-M4 里程碑实施计划 |
| `docs/猫屿验收报告.md` | 需求实现核对与验收说明 |

## 📝 说明

- 开发期使用占位数据（猫咪/餐单/图片均来自 CC0 免费图库），**正式上线前需替换为真实素材**（猫咪实拍、真实菜单、收款码、服务器与域名）。
- 后台仅店主 1 个管理员账号；前台免注册访问。
