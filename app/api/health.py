"""
=============================================================================
健康检查接口（API-21）
-----------------------------------------------------------------------------
版本     : V1.0（EP-0）
依据文档 : 《开发技术文档 V1.0》§5.8
-----------------------------------------------------------------------------
关键约定：
  - 挂根路径 /health，不在 /api/v1 下。
  - 不做鉴权（否则监控系统无法调用）；不得泄露路径/配置/连接串（NFR-SEC-09）。
  - API-21-1：status = degraded 的判定 = 数据库异常 或 模型未加载。
=============================================================================
"""
from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter

from app.core import config
from app.core.model_holder import holder

router = APIRouter(tags=["system"])

_START_TS = time.monotonic()


def _database_ok() -> bool:
    """轻量数据库连通性探测（只读，不创建文件）。"""
    db_path = config.settings.db_path
    if not db_path.exists():
        return False
    try:
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute("SELECT 1").fetchone()
        return True
    except sqlite3.Error:
        return False


@router.get("/health")
def health() -> dict:
    """健康检查：返回结构符合技术文档 §5.8 响应体约定。"""
    db_ok = _database_ok()
    model_loaded = holder.loaded
    status = "ok" if (db_ok and model_loaded) else "degraded"
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "status": status,
            "version": config.APP_VERSION,
            "database": "ok" if db_ok else "error",
            "model_loaded": model_loaded,
            "model_version": holder.version,
            "device": holder.device,
            "uptime_seconds": int(time.monotonic() - _START_TS),
        },
    }
