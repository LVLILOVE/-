"""
=============================================================================
日志配置
-----------------------------------------------------------------------------
版本     : V1.0（EP-0）
依据文档 : 《开发技术文档 V1.0》§4.6 日志规范
-----------------------------------------------------------------------------
关键约定：
  - 格式：%(asctime)s %(levelname)s [%(request_id)s] %(name)s - %(message)s
  - BE-22 🔒：遮蔽 password / authorization / access_token 等敏感字段。
  - request_id 通过 ContextVar 注入，由 RequestIDMiddleware 设置。
=============================================================================
"""
from __future__ import annotations

import logging
import re
from contextvars import ContextVar

# 每个请求的唯一标识，由 RequestIDMiddleware 设置，日志 Filter 读取
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# 匹配 "key=value" 或 "key: value" 形式的敏感字段值（大小写不敏感）
_SENSITIVE_RE = re.compile(
    r"(password|authorization|access_token|refresh_token|token)\s*[:=]\s*[\"']?[^\"'\s,;]*[\"']?",
    re.IGNORECASE,
)


class RequestIdFilter(logging.Filter):
    """把 ContextVar 中的 request_id 注入日志记录。"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class SensitiveFilter(logging.Filter):
    """BE-22：对敏感字段值做遮蔽，避免密码 / Token 原文进入日志。"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            message = record.getMessage()
        except Exception:  # pragma: no cover - 消息格式化异常不应影响记录
            return True
        masked = _SENSITIVE_RE.sub(r"\1=***", message)
        record.msg = masked
        record.args = ()
        return True


def configure_logging(level: int = logging.INFO) -> None:
    """初始化根日志器（幂等：清空既有 handler 后重建）。"""
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s [%(request_id)s] %(name)s - %(message)s"
        )
    )
    handler.addFilter(RequestIdFilter())
    handler.addFilter(SensitiveFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)
