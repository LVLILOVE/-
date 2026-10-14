"""
=============================================================================
首页硬指标的「构建期注入」同步脚本（DOD-EP3 / QD-06）
-----------------------------------------------------------------------------
问题：`UX-P01` 首页要展示 加权 MAPE / 相对基线降低 / 覆盖率 等硬指标。
      这些数字**禁止手写**（QD-06）。项目历史上出现过
      「原型显示一套数字、算法产出另一套数字」的问题（技术文档 `GIT-7`）。

做法：把算法侧唯一真源 `outputs/eval_report.json` **原样复制**到前端可
      `import` 的位置 `web/src/generated/eval_report.json`。
      前端 `web/src/generated/metrics.ts` 只做「读取 + 派生 + 格式化」，
      文件内**不得**出现任何指标数值字面量。

🔒 重训模型后必须按顺序重跑：
      python scripts/train_and_register.py
      python scripts/eval_report.py --horizon 14 --export-series
      python scripts/sync_eval_metrics.py        <-- 本脚本
      python scripts/sync_prototype_data.py
   否则 scripts/verify_ep3.py 的一致性比对会失败（这是**故意**设计的守卫）。

用法：
    python scripts/sync_eval_metrics.py          # 同步（写入前端）
    python scripts/sync_eval_metrics.py --check   # 只比对，不写（CI 用）
=============================================================================
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "outputs" / "eval_report.json"
DST = ROOT / "web" / "src" / "generated" / "eval_report.json"


def load(path: Path) -> dict:
    if not path.exists():
        raise SystemExit(
            f"缺少 {path.relative_to(ROOT)}。\n"
            "请先运行：python scripts/eval_report.py --horizon 14 --export-series"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def dump(obj: dict) -> str:
    # indent=2 + ensure_ascii=False：便于人读 diff；键顺序保持不变，
    # 这样「同源」这件事在 git diff 里也一眼可见。
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    check_only = "--check" in sys.argv
    src_obj = load(SRC)
    text = dump(src_obj)

    if check_only:
        if not DST.exists():
            print(f"❌ {DST.relative_to(ROOT)} 不存在，请先运行 python scripts/sync_eval_metrics.py")
            return 1
        dst_obj = load(DST)
        if dst_obj != src_obj:
            print("❌ 前端硬指标数据与 outputs/eval_report.json 不一致（构建期注入已过期）")
            print("   修复：python scripts/sync_eval_metrics.py")
            return 1
        print(f"✅ 一致：{DST.relative_to(ROOT)} == {SRC.relative_to(ROOT)}")
        return 0

    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(text, encoding="utf-8")
    m = src_obj.get("metrics", {})
    print(f"[write] 已生成 {DST.relative_to(ROOT)}  （{len(text)} 字节）")
    print(
        "        注入值：weighted_mape={}% / mae_improve={}% / rmse_improve={}% / "
        "series_pass={}% / total_ms={}".format(
            m.get("weighted_mape"),
            m.get("mae_improve_pct"),
            m.get("rmse_improve_pct"),
            m.get("series_pass_rate"),
            src_obj.get("timing_ms", {}).get("total_ms"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
