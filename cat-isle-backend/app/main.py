from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
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

@app.get("/")
def root():
    return {"code": 0, "msg": "猫屿 CAT ISLE API 运行中", "data": {"docs": "/docs"}}

app.include_router(auth.router)
app.include_router(public.router)
app.include_router(reservations.router)
app.include_router(adoptions.router)
app.include_router(admin.router)

# 静态资源：uploads（图片）+ 前端 dist（部署时放入 static/）
Path(settings.UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

static_dir = Path(__file__).resolve().parent.parent / "static"
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
