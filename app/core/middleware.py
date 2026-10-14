"""
=============================================================================
中间件链
-----------------------------------------------------------------------------
版本     : V1.0（EP-0）
依据文档 : 《开发技术文档 V1.0》§4.2 中间件链
-----------------------------------------------------------------------------
执行顺序（自上而下）：
  1. CORSMiddleware     跨域（在 main.py 注册）
  2. RequestIDMiddleware  为每个请求生成 request_id，注入日志上下文
  3. AccessLogMiddleware  记录方法 / 路径 / 耗时 / 状态码（不记录请求体，防泄露）
  4. TimeoutGuardMiddleware  预测预算控制（EP-5 实现，BE-16 软失败方案）
=============================================================================
"""
from __future__ import annotations

import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import request_id_var

logger = logging.getLogger(__name__)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """为每个请求生成短 request_id，贯穿该请求的全部日志。"""

    async def dispatch(self, request: Request, call_next):
        token = request_id_var.set(uuid.uuid4().hex[:12])
        try:
            return await call_next(request)
        finally:
            request_id_var.reset(token)


class AccessLogMiddleware(BaseHTTPMiddleware):
    """访问日志：方法、路径、状态码、耗时。不记录请求体（NFR-SEC-09）。"""

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "%s %s -> %s %.1fms",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response
