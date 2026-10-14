"""
=============================================================================
`_ep9_boot_probe.py` · 启动自检探针
-----------------------------------------------------------------------------
只做一件事：在**独立子进程**里触发一次 `lifespan`（建库 + 启动自检 + 预加载
模型），把「是否启动成功」与异常原文落盘，供 `verify_ep9_api.py` 断言 `B-18`。

用法（由父脚本调用）：
    ACTIVE_MODEL=lstm_nonexistent  python scripts/_ep9_boot_probe.py --out x.json

🔴 **为什么必须独立进程**：`APP_ENV` / `ACTIVE_MODEL` / `TORCH_DEVICE` 都在
   `config.settings`（`@dataclass(frozen=True)`）里，随模块导入即固化。
   要验证「配置错误时启动必须失败」（`BE-06` / §4.1.1 启动自检清单），
   只能另起一个进程让 `config` 读到新环境变量。

🔒 **必须在 `try` 里调 `TestClient(app).__enter__()`**：启动失败是通过
   lifespan 抛异常表达的，直接构造 `TestClient` 不触发 lifespan，
   会得到「启动成功」的假结论。
=============================================================================
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    from fastapi.testclient import TestClient

    from app.main import app

    payload: dict[str, object] = {
        "env": {
            "APP_ENV": os.environ.get("APP_ENV"),
            "ACTIVE_MODEL": os.environ.get("ACTIVE_MODEL"),
            "TORCH_DEVICE": os.environ.get("TORCH_DEVICE"),
            "DB_PATH": os.environ.get("DB_PATH"),
        }
    }

    try:
        with TestClient(app):
            payload["started"] = True
            payload["error"] = ""
    except BaseException as exc:  # noqa: BLE001 - 启动失败正是本探针要观察的现象
        payload["started"] = False
        payload["error"] = f"{type(exc).__name__}: {exc}"
        payload["traceback_tail"] = traceback.format_exc()[-2000:]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 70)
    print(f"started={payload['started']}  error={str(payload.get('error'))[:300]}")
    print(f"已写出：{out}")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
