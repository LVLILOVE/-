"""
=============================================================================
流水线元信息 → 前端构建期注入（`QD-06` 同型守卫，`EP-5`）
-----------------------------------------------------------------------------
问题：`UX-P06`（参数页）与 `UX-P07`（执行页）要展示一批**来自后端的常量**：
      - 五阶段的 key / 中文名 / 预算占比（时间轴宽度、「哪一段最贵」）
      - 每次任务的预算上限（60 s）
      - 内置节假日表（参数页右栏「窗口内节假日」）
      - L1 分级阈值、滑动窗口长度等算法事实

      如果在前端手抄一份，就会出现「后端改了、界面没改」的静默分叉 ——
      本项目的原型阶段已经踩过同型的坑（`GIT-7`「两套数字」），
      故沿用 `sync_eval_metrics.py` 的做法：**构建期从后端原样注入**。

产出：`web/src/generated/pipeline.ts`
     由 `scripts/verify_ep5.py` 断言「后端常量 == 生成文件内容」，
      任何一侧改动而忘记重跑本脚本都会在验收时失败。

用法：
    python scripts/sync_pipeline_meta.py          # 生成 / 更新
    python scripts/sync_pipeline_meta.py --check   # 只比对，不写
=============================================================================
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.algo import config as algo_config          # noqa: E402
from app.algo import features                       # noqa: E402
from app.core import config as app_config           # noqa: E402
from app.services import predict_service            # noqa: E402

DST = ROOT / "web" / "src" / "generated" / "pipeline.ts"

HEADER = """/**
 * =============================================================================
 * 流水线元信息 · 构建期注入（自动生成，**请勿手改**）
 * -----------------------------------------------------------------------------
 * 生成脚本 : scripts/sync_pipeline_meta.py
 * 真源     : app/services/predict_service.py（阶段与预算占比）
 *            app/algo/config.py（SLA / 步长 / 算法参数）
 *            app/algo/features.py（内置节假日表）
 *
 * 🔒 手改本文件会在 `scripts/verify_ep5.py` 的「生成内容 == 后端常量」比对中失败。
 *    需要变更时请改后端常量，然后重跑：
 *        python scripts/sync_pipeline_meta.py
 * =============================================================================
 */

"""


def build_ts() -> str:
    settings = app_config.settings
    stages = [
        {
            "key": k,
            "label": predict_service.STAGE_LABELS[k],
            "index": i + 1,
            "budget_ratio": predict_service.STAGE_BUDGET_RATIO[k],
        }
        for i, k in enumerate(predict_service.STAGES)
    ]
    body = {
        "STAGE_TOTAL": predict_service.STAGE_TOTAL,
        "STAGES": stages,
        "TASK_BUDGET_MS": settings.task_budget_ms,
        "MAX_SERIES": settings.max_series,
        "HORIZONS": list(algo_config.HORIZONS),
        "L1_MIN_VALID_POINTS": algo_config.L1_MIN_VALID_POINTS,
        "WINDOW_SIZE": algo_config.WINDOW_SIZE,
        "BASELINE_WINDOW": algo_config.BASELINE_WINDOW,
        "HOLIDAYS": features.HOLIDAYS,
    }
    return (
        HEADER
        + "export const PIPELINE_META = "
        + json.dumps(body, ensure_ascii=False, indent=2)
        + " as const;\n"
        + "\n"
        + "export type PipelineStageMeta = (typeof PIPELINE_META.STAGES)[number];\n"
    )


def main() -> int:
    text = build_ts()
    if "--check" in sys.argv:
        if not DST.exists():
            print(f"❌ {DST.relative_to(ROOT)} 不存在，请运行 python scripts/sync_pipeline_meta.py")
            return 1
        if DST.read_text(encoding="utf-8") != text:
            print("❌ 前端流水线元信息与后端常量不一致（构建期注入已过期）")
            print("   修复：python scripts/sync_pipeline_meta.py")
            return 1
        print(f"✅ 一致：{DST.relative_to(ROOT)}")
        return 0

    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(text, encoding="utf-8")
    print(f"[write] 已生成 {DST.relative_to(ROOT)}（{len(text)} 字节）")
    print(
        "        阶段预算占比：" + " · ".join(
            f"{s['key']}={s['budget_ratio']:.3f}" for s in json.loads(
                text.split("PIPELINE_META = ", 1)[1].rsplit("as const;", 1)[0]
            )["STAGES"]
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
