#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
=============================================================================
`WS-10-03` API 接口文档 —— 自包含离线 HTML 生成
-----------------------------------------------------------------------------
依据文档 : 《项目开发实施方案 V1.0》§7.11 `WS-10-03`
           「导出 OpenAPI；🔒 Swagger 资源离线化（国内网络必需）」
           《项目任务书 V1.0.0》§5.2（API 接口文档为交付物）
-----------------------------------------------------------------------------
产出：`outputs/电商销量预测系统_API接口文档_V1.0.html`

为什么是「自包含」而不是「引用本地资源」
-----------------------------------------------------------------------------
随服务发布的 `/docs` 依赖 HTTP 服务与相对路径；一旦把 HTML 单独拷给评审方
（或离线打开），外链资源缺失又是一次白屏。故本脚本把三样东西**全部内联**：

  · `swagger-ui.css`          → `<style>`
  · `swagger-ui-bundle.js`    → `<script>`
  · `app.openapi()` 的 spec   → `<script>` 里以 JS 字面量注入

结果是一个 **单文件、零外链、双击可开** 的接口文档。文件较大（约 1.7 MB）是
刻意的取舍：它的用途是「归档 / 评审 / 离线查看」，不参与线上请求。

🔒 产出的 HTML 内**不允许出现任何 `http(s)://` 资源引用**，由
   `scripts/verify_ep10_docs.py` 断言（正则扫 `src` / `href`）。

运行
-----------------------------------------------------------------------------
    <deploy python> scripts/build_api_doc_html.py
=============================================================================
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

VENDOR = ROOT / "app" / "static" / "vendor" / "swagger-ui"
OUT_HTML = ROOT / "outputs" / "电商销量预测系统_API接口文档_V1.0.html"

# 与 app/main.py 的 SWAGGER_VERSION 保持一致（两处改动必须同步；
# verify_ep10_docs.py 会做同源断言，防止只改一处造成版本漂移）。
SWAGGER_VERSION = "5.33.1"


def main() -> int:
    from app.main import app  # noqa: E402

    spec = app.openapi()
    css = (VENDOR / "swagger-ui.css").read_text(encoding="utf-8")
    js = (VENDOR / "swagger-ui-bundle.js").read_text(encoding="utf-8")

    paths = spec.get("paths", {})
    ops = sum(
        1
        for item in paths.values()
        for m in item
        if m.lower() in {"get", "post", "put", "patch", "delete"}
    )

    # 🔒 spec 内联时必须转义 `</script>`（JSON 里出现该串会提前闭合脚本标签）。
    #    本项目标题/描述均为中文短文本，实际不含，但这行不能省 —— 它是那类
    #    「今天没有、明天加了字段就炸」的隐患。
    spec_json = json.dumps(spec, ensure_ascii=False).replace("</", "<\\/")

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>电商销量预测系统 · API 接口文档（V1.0）</title>
<!--
  ==========================================================================
  电商销量预测系统 —— API 接口文档（离线自包含）
  --------------------------------------------------------------------------
  生成方式 : scripts/build_api_doc_html.py
  契约来源 : app.openapi()（FastAPI 运行时对象，与 /docs 同源）
  Swagger UI : v{SWAGGER_VERSION}（MIT，随资源一并归档）
  生成日期 : {date.today().isoformat()}
  --------------------------------------------------------------------------
  🔒 本文件零外链：CSS / JS / OpenAPI spec 全部内联，可离线双击打开。
  ==========================================================================
-->
<style>
{css}
</style>
<style>
  /* 顶部说明条：区分「归档件」与「线上 /docs」，避免评审误以为要联服务 */
  #doc-banner {{
    font-family: -apple-system, "Microsoft YaHei", Segoe UI, sans-serif;
    background: #0f172a; color: #e2e8f0; padding: 14px 22px;
    display: flex; flex-wrap: wrap; gap: 8px 26px; align-items: baseline;
    position: sticky; top: 0; z-index: 9999; box-shadow: 0 2px 8px rgba(0,0,0,.25);
  }}
  #doc-banner b {{ color: #7dd3fc; font-size: 16px; }}
  #doc-banner span {{ font-size: 13px; color: #cbd5e1; }}
  #doc-banner code {{ background: #1e293b; padding: 1px 6px; border-radius: 4px; color: #a5f3fc; }}
</style>
</head>
<body>
<div id="doc-banner">
  <b>电商销量预测系统 · API 接口文档 V1.0</b>
  <span>契约版本 <code>{spec['info']['version']}</code> · OpenAPI <code>{spec.get('openapi')}</code></span>
  <span>接口 <code>{len(paths)}</code> 个路径 / <code>{ops}</code> 个操作 · Schema <code>{len(spec.get('components', {}).get('schemas', {}))}</code> 个</span>
  <span>离线自包含件 · 运行时同源地址 <code>/docs</code></span>
</div>
<div id="swagger-ui"></div>
<script>
{js}
</script>
<script>
  window.ui = SwaggerUIBundle({{
    spec: {spec_json},
    dom_id: '#swagger-ui',
    deepLinking: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 1,
    persistAuthorization: true,
    displayRequestDuration: true,
    tryItOutEnabled: false,
  }});
</script>
</body>
</html>
"""

    OUT_HTML.parent.mkdir(parents=True, exist_ok=True)
    OUT_HTML.write_text(html, encoding="utf-8")

    # 🔒 自检：产出物不得含任何外部资源引用（`<a href>` 里的外链由 spec 决定，
    #    本处只扫 src/href 属性中的 http(s)，与 verify 脚本口径一致）。
    external = re.findall(r'(?:src|href)\s*=\s*["\']https?://[^"\']+', html)
    assert not external, f"产出 HTML 存在外部资源引用：{external[:3]}"

    size_mb = OUT_HTML.stat().st_size / 1024 / 1024
    print(f"[OK] {OUT_HTML.relative_to(ROOT)}  ({size_mb:.2f} MB)")
    print(f"     路径 {len(paths)} / 操作 {ops} / 零外链校验通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
