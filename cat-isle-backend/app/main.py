from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from .core.config import settings
from .core.response import BizError
from .routers import auth, public, reservations, adoptions, admin
from .tasks.scheduler import start_scheduler
from .seed import seed

@asynccontextmanager
async def lifespan(app: FastAPI):
    seed()                                   # 建表 + 种子 + 部分唯一索引
    sched = start_scheduler()                # 定时任务（生产必须 --workers 1）
    yield
    sched.shutdown(wait=False)

app = FastAPI(title="猫屿 CAT ISLE API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],                     # 单机部署可收紧为具体域名
    allow_methods=["*"],
    allow_headers=["*"],
)

# 统一响应 & 业务异常处理
@app.exception_handler(BizError)
async def biz_error_handler(_: Request, exc: BizError):
    return JSONResponse(status_code=200, content={"code": exc.code, "msg": exc.msg, "data": None})

@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    """Pydantic 校验失败 → 统一 40001（对齐错误码表）"""
    first = exc.errors()[0]
    loc = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    return JSONResponse(status_code=422, content={
        "code": 40001, "msg": f"参数错误：{loc} {first['msg']}", "data": None})

# 静态资源目录：前端构建产物（由 M4 联调阶段复制 dist/* 到 static/）
static_dir = Path(__file__).resolve().parent.parent / "static"

@app.get("/")
def root():
    # 已接入前端产物时，根路径返回 SPA 首页；否则返回 API 状态信息（开发态）
    if (static_dir / "index.html").exists():
        return FileResponse(static_dir / "index.html")
    return {"code": 0, "msg": "猫屿 CAT ISLE API 运行中", "data": {"docs": "/docs"}}

app.include_router(auth.router)
app.include_router(public.router)
app.include_router(reservations.router)
app.include_router(adoptions.router)
app.include_router(admin.router)

# 静态资源：uploads（图片）+ 前端构建产物（static/）
Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# ============================================================
# 代码段功能：前端 SPA 静态托管与路由回退（M4 联调）
# - /assets/* → 直接返回构建产物（JS/CSS，带内容 hash 可长缓存）
# - 其他路径（SPA 路由如 /cats、/admin）→ 返回 index.html 交给前端路由
# - /api /uploads /docs 等接口路径由上面的路由先行处理，不落入回退
# ============================================================
if static_dir.exists():
    # 构建产物目录挂载（assets 由 Vite 产出，含 hash 文件名）
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    # SPA 回退路由：命中真实文件返回文件，否则返回 index.html
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # 接口/文档路径兜底 404（正常不会到达此处）
        if full_path.startswith(("api/", "uploads/", "docs", "openapi.json")):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = static_dir / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(static_dir / "index.html")
