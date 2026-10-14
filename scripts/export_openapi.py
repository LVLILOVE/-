#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
=============================================================================
`WS-10-03` API 接口文档导出（OpenAPI 归档件）
-----------------------------------------------------------------------------
依据文档 : 《项目开发实施方案 V1.0》§7.11 `WS-10-03`
           「导出 OpenAPI；🔒 Swagger 资源离线化」
           《开发技术文档 V1.0》§10.4（Swagger UI 资源离线化 / `DEP-4`）
           《项目任务书 V1.0.0》§5.2（「AI Coding 中间文件：… API 接口文档 …」）
-----------------------------------------------------------------------------
产出（写入 `outputs/`）：

  1. `电商销量预测系统_openapi.json`  —— 机器可读的接口契约（交付归档件）
  2. `outputs/_openapi_summary.txt`   —— 人读摘要（接口数 / 分组 / 方法分布）

为什么必须导出成文件，而不只是「有 `/docs` 页面」
-----------------------------------------------------------------------------
`/docs` 是**运行时**视图：服务停了就没有，评审方拿到的只是「当时打开过」。
交付物要能被归档、被 diff、被导入 Apifox / Postman，所以必须落成静态文件。
本脚本保证**落盘的那份**与运行时 `app.openapi()` 是同一对象序列化而来，
不存在「文档一套、接口一套」。

🔒 顺序约定：本脚本**不启动服务**，直接 import 应用取 `app.openapi()`。
   好处是可在 CI 里无副作用运行；代价是它拿到的是「导入期」的契约，
   运行期动态注册的路由（本项目没有）不会出现。

运行
-----------------------------------------------------------------------------
    <deploy python> scripts/export_openapi.py
=============================================================================
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

OUTPUTS = ROOT / "outputs"
JSON_OUT = OUTPUTS / "电商销量预测系统_openapi.json"
SUMMARY_OUT = OUTPUTS / "_openapi_summary.txt"


def main() -> int:
    # 环境变量必须在 import 应用之前生效：`settings` 是 frozen dataclass，
    # 一旦 import 就固化，之后再设 `APP_ENV` 等不再起作用（`EP-9` 踩过）。
    from app.main import app  # noqa: E402  （延迟 import，见上）

    spec = app.openapi()

    OUTPUTS.mkdir(parents=True, exist_ok=True)
    JSON_OUT.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    paths = spec.get("paths", {})
    method_counter: Counter[str] = Counter()
    tag_counter: Counter[str] = Counter()
    for path, item in paths.items():
        for method, op in item.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete", "head", "options"}:
                continue
            method_counter[method.upper()] += 1
            for tag in op.get("tags", ["(未分组)"]):
                tag_counter[tag] += 1

    lines: list[str] = []
    lines.append("=" * 74)
    lines.append("电商销量预测系统 API —— OpenAPI 契约摘要")
    lines.append("=" * 74)
    lines.append(f"标题        : {spec['info']['title']}")
    lines.append(f"版本        : {spec['info']['version']}")
    lines.append(f"OpenAPI     : {spec.get('openapi')}")
    lines.append(f"路径数(paths): {len(paths)}")
    lines.append(f"操作数(ops)  : {sum(method_counter.values())}")
    lines.append(f"Schema 数    : {len(spec.get('components', {}).get('schemas', {}))}")
    lines.append("")
    lines.append("按 HTTP 方法：")
    for m in sorted(method_counter):
        lines.append(f"  {m:<7} {method_counter[m]}")
    lines.append("")
    lines.append("按业务分组(tag)：")
    for t in sorted(tag_counter):
        lines.append(f"  {t:<16} {tag_counter[t]}")
    lines.append("")
    lines.append("路径清单：")
    for path in sorted(paths):
        methods = sorted(
            m.upper()
            for m in paths[path]
            if m.lower() in {"get", "post", "put", "patch", "delete"}
        )
        lines.append(f"  {','.join(methods):<16} {path}")
    lines.append("")

    SUMMARY_OUT.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    print(f"[OK] 已写出 {JSON_OUT.relative_to(ROOT)}")
    print(f"[OK] 已写出 {SUMMARY_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
