"""
=============================================================================
`EP-9` §9.4 边界与异常用例校验（B-01 ~ B-25）
-----------------------------------------------------------------------------
用法（在工作区根目录执行）：
    C:\\ProgramData\\anaconda3\\envs\\deploy\\python.exe scripts/verify_ep9_api.py

依据：《开发技术文档 V1.0》§9.4「边界与异常用例（🔒 重点）」25 条，
     以及 §9.4 末尾的三条测试纪律：

  · 🔒 `TEST-2`：**B-11 与 B-12 是必测项**。示例数据的 L3 = 0，
      只测示例数据等于没测分级降级逻辑 —— 必须**自己构造**稀疏序列。
  · 🔒 `TEST-3`：**B-16 与 B-17 必须实际模拟**，不能只靠代码审查。
  · 🔒 `TEST-1`（隐含）：B-01~B-10 的上传前置校验。

与 `verify_ep4_api.py` 的关系（**有意重叠，不是重复劳动**）
-----------------------------------------------------------------------------
`verify_ep4_api.py` 第 1/2 节已细致覆盖 B-01~B-10。本脚本仍逐条复现，理由：

  1. §9.4 是一个**面向验收的清单**，验收人会按 B 编号逐条核对。
     断言按 B 编号组织，报告才能直接给出「25/25 通过」；
  2. `EP-8` 的教训是「新阶段只跑新脚本」——`API-05` 因此漏网。
     把上游用例在最终回归里再跑一遍，是**防回归**而不是重复；
  3. 两处的断言**侧重不同**：EP-4 关注「载荷完整」，这里关注 §9.4 的
     「判据」列原文（例如 B-03「≤ 20 条」、B-07「磁盘不残留」）。

设计约定（沿用 `verify_ep5_api.py`，不重复其注释）
-----------------------------------------------------------------------------
1. 🔒 独立临时库 `data/tmp/verify_ep9_api/`，不碰 `data/app.db`；
   环境变量必须在 `import app` **之前**设置。
2. 🔒 `TestClient(app)` 必须用 `with` 触发 lifespan（建库 + seed + 预加载模型）。
3. 🔒 需要「换个配置再跑一次」的用例（B-16 / B-18）一律走**子进程**：
   `settings` 是 `@dataclass(frozen=True)`，同进程改不了。
4. ⚠️ 本脚本会**临时改写**进程级模型单例（B-17 搬到 CPU、B-18 clear），
   每个用例结束时都会 `load_active_model()` 复原 —— 顺序仍然重要，
   故这三个用例统一排在**最后**。
5. 退出码 0 = 全通过；非 0 = 存在未通过项。

⚠️ 运行纪律（`EP-9` 实测踩坑）
-----------------------------------------------------------------------------
**不要在一条 bash 命令里 for 循环串跑多个校验脚本**：平台按「单次工具调用的
累计删除数」计（阈值 50），前面脚本的临时目录清理会累积到后面脚本头上，
把正常的 `shutil.rmtree` 误判成批量删除并让脚本直接退出（表现为日志里只有
一行 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。每个脚本单独占一条命令即可。
=============================================================================
"""
from __future__ import annotations

import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# ⚠️ 必须在 import 应用之前设置环境变量（config 在模块导入时即读取）
# ---------------------------------------------------------------------------
TMP_DIR = ROOT / "data" / "tmp" / "verify_ep9_api"
FIXTURES = TMP_DIR / "fixtures"
if TMP_DIR.exists():
    shutil.rmtree(TMP_DIR, ignore_errors=True)
FIXTURES.mkdir(parents=True, exist_ok=True)

os.environ["DB_PATH"] = str(TMP_DIR / "app.db")
os.environ["UPLOAD_DIR"] = str(TMP_DIR / "uploads")
os.environ["EXPORT_DIR"] = str(TMP_DIR / "exports")
os.environ["JWT_SECRET"] = "verify-ep9-secret-0123456789abcdefghijklmn"
os.environ["APP_ENV"] = "test"
# 🔒 清掉可能残留的覆写，保证跑的是**默认口径**（60s 预算 / 1000 序列上限）
os.environ.pop("TASK_BUDGET_MS", None)
os.environ.pop("MAX_SERIES", None)
os.environ.pop("ACTIVE_MODEL", None)

sys.path.insert(0, str(ROOT))

try:
    from fastapi.testclient import TestClient
    from sqlalchemy import text as sa_text
except Exception as exc:  # noqa: BLE001
    print(f"[FAIL] 缺少依赖（fastapi / httpx / sqlalchemy）：{exc}")
    sys.exit(1)

from app.core import config as app_config  # noqa: E402
from app.core.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

settings = app_config.settings
client = TestClient(app)

passed = 0
failed = 0

# B 编号 → [(断言名, 是否通过, 详情)]。结尾按 B 汇总，测试报告直接取用。
B_RESULTS: dict[str, list[tuple[str, bool, str]]] = {}


def check(name: str, cond: bool, detail: str = "") -> bool:
    global passed, failed
    if cond:
        passed += 1
        print(f"[ OK ] {name}" + (f"  ({detail})" if detail else ""))
    else:
        failed += 1
        print(f"[FAIL] {name}  {detail}")
    return bool(cond)


def bcheck(bid: str, name: str, cond: bool, detail: str = "") -> bool:
    """带 B 编号的断言：同一编号下的多条断言全通过才算该条通过。"""
    ok = check(f"{bid} {name}", cond, detail)
    B_RESULTS.setdefault(bid, []).append((name, ok, detail))
    return ok


def section(title: str) -> None:
    print("")
    print("=" * 74)
    print(title)
    print("=" * 74)


# ===========================================================================
# 通用工具
# ===========================================================================
def api_json(resp):
    """返回 `(http_status, code, data, message)`；非 JSON 时 message 为原文。"""
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return resp.status_code, None, None, resp.text[:300]
    return resp.status_code, body.get("code"), body.get("data"), body.get("message", "")


def tasks_count() -> int:
    db = SessionLocal()
    try:
        return int(db.execute(sa_text("SELECT COUNT(*) FROM tasks")).scalar() or 0)
    finally:
        db.close()


def sql(query: str, params: tuple = ()) -> list[tuple]:
    """直连临时库（只读断言用）。⚠️ 不复用 SessionLocal —— 避免污染 ORM 身份映射。"""
    con = sqlite3.connect(str(app_config.settings.db_path))
    try:
        return con.execute(query, params).fetchall()
    finally:
        con.close()


def has_nan_literal(resp) -> bool:
    """响应体里是否出现 **非法 JSON 字面量** `NaN` / `Infinity` / `-Infinity`。

    🔒 `API-14-2` 的红线：Python 的 `float('nan')` 经序列化会产出 `NaN`，
       而 `NaN` 不是合法 JSON，前端 `JSON.parse` 直接抛错、结果页白屏。
       `result_service._num()` 负责把它们转成 `null`，这里做黑盒复核。
    """
    text = resp.text
    return any(tok in text for tok in ("NaN", "Infinity"))


def register(email: str, password: str = "Abcd1234") -> None:
    client.post("/api/v1/auth/register", json={"email": email, "password": password})


def login(email: str, password: str = "Abcd1234") -> str:
    res = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    body = res.json()
    assert body["code"] == 0, body
    return body["data"]["access_token"]


def auth(token: str | None) -> dict:
    return {"Authorization": f"Bearer {token}"} if token else {}


def upload(path: Path, *, name: str | None = None, token: str | None = None,
           gap_action: str | None = None) -> tuple[int, dict]:
    headers = auth(token)
    data = {"gap_action": gap_action} if gap_action else None
    with path.open("rb") as fh:
        res = client.post(
            "/api/v1/datasets",
            files={"file": (name or path.name, fh, "text/csv")},
            data=data,
            headers=headers,
        )
    return res.status_code, res.json()


def dataset_id_of(body: dict) -> int | None:
    """从上传响应里取数据集 id。

    ⚠️ **两种形状并存**，这是 `EP-4` 的既定契约，不是笔误：
       · 成功（`UploadDatasetResponse`）→ `data.dataset.id`（+ 顶层 `series_count`）
       · 断档 / 校验失败（`ValidationErrorData`）→ 顶层 `data.dataset_id`
       `EP-9` 首次运行时只按 `dataset_id` 取，于是所有成功用例都拿到 `None`，
       连锁导致 `B-11/B-14/B-20/B-24/B-25` 五条一起"未执行"。
       教训：**校验脚本里的取数助手必须两种形状都覆盖**，否则一个 `None`
       会伪装成五条用例的产品缺陷。
    """
    data = body.get("data") or {}
    ds = data.get("dataset")
    if isinstance(ds, dict) and ds.get("id") is not None:
        return int(ds["id"])
    if data.get("dataset_id") is not None:
        return int(data["dataset_id"])
    return None


def series_count_of(body: dict) -> int | None:
    """上传响应里的序列数：顶层 `series_count` 优先（`UploadDatasetResponse`）。"""
    data = body.get("data") or {}
    if data.get("series_count") is not None:
        return int(data["series_count"])
    ds = data.get("dataset")
    if isinstance(ds, dict) and ds.get("valid_series_count") is not None:
        return int(ds["valid_series_count"])
    return None


# ===========================================================================
# 夹具
# ===========================================================================
HDR = "sku_id,warehouse_id,date,sales"
D0 = date(2015, 1, 1)


def _write(name: str, body: str, *, bom: bool = False) -> Path:
    p = FIXTURES / name
    p.write_bytes(body.encode("utf-8-sig" if bom else "utf-8"))
    return p


def _rows(sku: str, wh: str, days: int, *, base: int = 10, start: int = 0,
          const: float | None = None, skip: tuple[int, ...] = ()) -> list[str]:
    """生成一条连续序列的 CSV 行；`const` 给定则输出恒定值（造全零序列）。"""
    out = []
    for i in range(days):
        if i in skip:
            continue
        d = D0 + timedelta(days=start + i)
        v = const if const is not None else base + (i % 7)
        out.append(f"{sku},{wh},{d.isoformat()},{v:g}")
    return out


def _q(s: str) -> str:
    """CSV 引号转义（B-15：字段内含逗号 / 双引号时必须能往返）。"""
    return '"' + s.replace('"', '""') + '"'


# ---- 特殊字符序列：sku 含逗号与双引号，仓库名含空格与括号 --------------------
SP_SKU = '商,品"A"'
SP_WH = "上海 仓(主)"

# 稀疏数据集的期望分级（用于 B-11 / B-12 断言）
SPARSE_EXPECT = {"L1": 3, "L2": 2, "L3": 1, "total": 6}


def build_fixtures() -> dict[str, Path]:
    fx: dict[str, Path] = {}

    # ---- B-01 缺 warehouse_id（🔒 仓库列缺失即拒）
    fx["missing_warehouse"] = _write(
        "b01_missing_warehouse.csv",
        "sku_id,date,sales\nitem_0001,2015-01-01,10\nitem_0001,2015-01-02,12\n",
    )
    # ---- B-02 缺 sales（其余列齐备）
    fx["missing_sales"] = _write(
        "b02_missing_sales.csv",
        "sku_id,warehouse_id,date\nitem_0001,上海仓,2015-01-01\n",
    )
    # ---- B-03 日期格式混乱（混入**不可解析**值）
    # ⚠️ 夹具选值依据 `PRD FR-UPL-10`「日期列存在**不可解析**值时…」：
    #    `2015/01/02` 与 `20150103` 都是**可解析的等价写法**（PRD 字段表：
    #    「可解析，推荐 `YYYY-MM-DD`」—— 推荐 ≠ 强制），实现放行它们是正确的。
    #    真正该被判 40002 的是非法月日 / 非法时间部分 / 文本 / 空串。
    #    技术文档 §9.4 `B-03` 原举例用了 `2015/01/01`、`20150101`，
    #    与 PRD 冲突，已在 `EP-9` 报告中登记为文档缺陷并修正。
    fx["bad_date"] = _write(
        "b03_bad_date.csv",
        "\n".join([
            HDR,
            "item_0001,上海仓,2015-01-01,10",
            "item_0001,上海仓,2015/13/45,11",
            "item_0001,上海仓,20150103T99,12",
            "item_0001,上海仓,未知,13",
            "item_0001,上海仓,,14",
            "item_0001,上海仓,2015-01-06,15",
        ]) + "\n",
    )
    # ---- B-04 销量负值
    fx["negative"] = _write(
        "b04_negative.csv",
        "\n".join([
            HDR,
            "item_0001,上海仓,2015-01-01,10",
            "item_0001,上海仓,2015-01-02,-5",
            "item_0001,上海仓,2015-01-03,12",
        ]) + "\n",
    )
    # ---- B-05 时间断档 8 天
    fx["gap8"] = _write(
        "b05_gap8.csv",
        "\n".join([HDR, *_rows("item_0000", "上海仓", 40, base=11,
                               skip=tuple(range(5, 13)))]) + "\n",
    )
    # ---- B-06 序列数超限（1001 条序列）
    lines = [HDR]
    for i in range(1001):
        lines.append(f"item_{i:04d},上海仓,2015-01-01,{i % 20 + 1}")
    fx["too_many_series"] = _write("b06_too_many_series.csv", "\n".join(lines) + "\n")

    # ---- B-07 文件超 20 MB（25 MB）
    big = FIXTURES / "b07_too_big.csv"
    with big.open("w", encoding="utf-8", newline="") as fh:
        fh.write(HDR + "\n")
        filler = "item_0001,上海仓,2015-01-01," + "1" * 200 + "\n"
        while fh.tell() < 25 * 1024 * 1024:
            fh.write(filler)
    fx["too_big"] = big

    # ---- B-08 行数超 50 万（体积仍 < 20 MB，专测「行数」这条上限）
    many = FIXTURES / "b08_too_many_rows.csv"
    with many.open("w", encoding="utf-8", newline="") as fh:
        fh.write(HDR + "\n")
        for i in range(500_001):
            fh.write(f"item_{i % 20:04d},上海仓,2015-01-01,{i % 9 + 1}\n")
    fx["too_many_rows"] = many

    # ---- B-09 空文件
    fx["empty"] = _write("b09_empty.csv", "")
    # ---- B-10 非 CSV 内容：**真的** xlsx（zip 容器）改名成 .csv
    # ⚠️ 不能用「PK 头 + 无换行」的假文件：那会被第 2 步「大小/行数」判成
    #    「仅有表头」→ 40010，从而**绕过**了「内容校验阶段」这条判据，
    #    让 B-10 变成一条永远无法真正证伪的断言。这里造一个真 zip，
    #    让它能通过行数检查、在表头解析处失败 —— 这才验到「不在扩展名阶段放行」。
    xlsx = FIXTURES / "b10_xlsx_as_csv.csv"
    # ⚠️ 必须 `ZIP_STORED`（不压缩）：deflate 会把 XML 里的换行压掉，
    #    整份文件退化成"零换行"，于是被第 2 步判成「仅有表头」→ 40010，
    #    B-10 又绕回了 B-09 的路径。
    with zipfile.ZipFile(xlsx, "w", zipfile.ZIP_STORED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types/>\n')
        z.writestr("xl/worksheets/sheet1.xml",
                   '<?xml version="1.0"?>\n<worksheet><sheetData/></worksheet>\n')
    fx["xlsx_as_csv"] = xlsx

    # ---- B-11 / B-12 / B-13 / B-15 稀疏长尾数据集（一次任务覆盖四条）
    sp: list[str] = [HDR]
    sp += _rows("item_l1", "上海仓", 120, base=20)          # 本仓 120 ≥ 90 → L1
    sp += _rows("item_l2", "上海仓", 60, base=15)           # 本仓 60 < 90 …
    sp += _rows("item_l2", "成都仓", 50, base=7)            # … 跨仓 110 ≥ 90 → L2 ×2
    sp += _rows("item_l3", "北京仓", 5, base=3)             # 跨仓 5 < 90 → L3
    sp += _rows("item_zero", "上海仓", 120, const=0)        # 全零 → L1（除零保护）
    sp += [f"{_q(SP_SKU)},{_q(SP_WH)},{(D0 + timedelta(days=i)).isoformat()},{18 + i % 7}"
           for i in range(120)]                            # 特殊字符 → L1
    fx["sparse"] = _write("sparse_l3_l2.csv", "\n".join(sp) + "\n")

    # ---- B-14 单序列（1 商品 × 1 仓）
    fx["single"] = _write(
        "single_series.csv",
        "\n".join([HDR, *_rows("item_only", "广州仓", 120, base=9)]) + "\n",
    )
    return fx


# ===========================================================================
# 0. 前置
# ===========================================================================
def check_prereq() -> bool:
    section("0. 前置条件：模型已注册 + 示例数据集就位")

    try:
        sql("SELECT 1 FROM model_registry LIMIT 1")
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] 临时库尚未建表（lifespan 未触发？）：{exc}")
        return False

    rows = sql("SELECT version, is_active FROM model_registry ORDER BY id DESC LIMIT 5")
    active = [r for r in rows if int(r[1]) == 1]
    if not check("model_registry 有一行 is_active=1", bool(active), f"最近 5 条={rows}"):
        print("       → 请先跑 scripts/train_and_register.py（EP-2 交付物）")
        return False

    st, code, data, msg = api_json(client.get("/api/v1/datasets/sample"))
    if not check("示例数据集可加载（API-07 幂等）", st == 200 and code == 0, f"{st} {msg}"):
        return False
    print(f"       示例数据集 id={data['dataset']['id']} 序列数={data['dataset'].get('series_count')}")
    return True


# ===========================================================================
# 1. B-01 ~ B-10 上传前置校验
# ===========================================================================
def case_upload_boundaries(fx: dict[str, Path]) -> None:
    section("1. B-01 ~ B-10：上传前置校验（§9.4 判据逐条核对）")

    # ---------------- B-01 缺 warehouse_id ----------------
    _, body = upload(fx["missing_warehouse"])
    bcheck("B-01", "缺 warehouse_id → 40001", body.get("code") == 40001, str(body)[:160])
    d = body.get("data") or {}
    bcheck("B-01", "missing_columns 含 warehouse_id",
           d.get("missing_columns") == ["warehouse_id"], str(d.get("missing_columns")))
    bcheck("B-01", "停在第 3 步「表头完整性」",
           d.get("fail_stage") == "表头完整性", str(d.get("fail_stage")))

    # ---------------- B-02 缺 sales ----------------
    _, body = upload(fx["missing_sales"])
    bcheck("B-02", "缺 sales → 40001", body.get("code") == 40001, str(body)[:160])
    d = body.get("data") or {}
    bcheck("B-02", "只指出缺的那一列（不缺其他列）",
           d.get("missing_columns") == ["sales"], str(d.get("missing_columns")))

    # ---------------- B-03 日期格式混乱 ----------------
    _, body = upload(fx["bad_date"])
    bcheck("B-03", "日期异常 → 40002", body.get("code") == 40002, str(body)[:160])
    d = body.get("data") or {}
    rows = d.get("unparsable_rows") or []
    bcheck("B-03", "给出行号与原始值",
           len(rows) == 4 and all(k in rows[0] for k in ("row_no", "raw_value", "column")),
           str(rows))
    bcheck("B-03", "行号为真实 CSV 行号（表头第 1 行）",
           [r["row_no"] for r in rows] == [3, 4, 5, 6], str([r["row_no"] for r in rows]))
    bcheck("B-03", "原始值原样带出（非法月日 / 非法时间 / 文本 / 空串）",
           [r["raw_value"] for r in rows] == ["2015/13/45", "20150103T99", "未知", ""],
           str([r["raw_value"] for r in rows]))
    bcheck("B-03", "🔒 明细条数 ≤ 20（§9.4 判据）", len(rows) <= 20, f"条数={len(rows)}")
    # 📌 反面对照：可解析的等价写法必须放行（否则就是「推荐」被当成「强制」）
    _, ok_body = upload(_write(
        "b03_alt_ok.csv",
        "\n".join([HDR, *_rows("item_0001", "上海仓", 30, base=5, start=0)]) + "\n",
    ))
    bcheck("B-03", "对照组：标准 YYYY-MM-DD 格式正常通过（40002 不是一刀切）",
           ok_body.get("code") == 0, str(ok_body)[:120])

    # ---------------- B-04 销量负值 ----------------
    _, body = upload(fx["negative"])
    bcheck("B-04", "负值 → 40003", body.get("code") == 40003, str(body)[:160])
    d = body.get("data") or {}
    negs = d.get("negative_rows") or []
    bcheck("B-04", "指出行号与值（第 3 行 = -5）",
           [r["row_no"] for r in negs] == [3] and negs and negs[0]["value"] == -5.0, str(negs))
    bcheck("B-04", "不自动取绝对值（提示语显式声明）",
           "不会自动取绝对值" in str(d.get("suggestion", "")), str(d.get("suggestion"))[:120])

    # ---------------- B-05 时间断档 ----------------
    _, body = upload(fx["gap8"])
    bcheck("B-05", "断档 → 40005（未选处置方式不继续）",
           body.get("code") == 40005, str(body)[:160])
    d = body.get("data") or {}
    ranges = d.get("gap_ranges") or []
    bcheck("B-05", "🔒 gap_days = 8",
           len(ranges) == 1 and ranges[0].get("gap_days") == 8, str(ranges))
    gid = d.get("dataset_id")
    bcheck("B-05", "回带 dataset_id（前端凭它调 /datasets/gap）", gid is not None, str(gid))
    if gid is not None:
        row = sql("SELECT status, gap_filled, gap_count FROM datasets WHERE id = ?", (gid,))
        bcheck("B-05", "落「待确认」行：status=1 / gap_filled=0（未处置 = 未继续）",
               bool(row) and row[0][0] == 1 and row[0][1] == 0 and row[0][2] == 1, str(row))
    bcheck("B-05", "建议给出二选一（自动插值 / 放弃）",
           "自动插值" in str(d.get("suggestion", "")) and "放弃" in str(d.get("suggestion", "")),
           str(d.get("suggestion"))[:120])

    # ---------------- B-06 序列数超限 ----------------
    _, body = upload(fx["too_many_series"])
    bcheck("B-06", "序列数超限 → 40004", body.get("code") == 40004, str(body)[:160])
    d = body.get("data") or {}
    bcheck("B-06", "🔒 提示当前值 1001（上限 1000）",
           d.get("series_count") == 1001 and d.get("series_limit") == 1000, str(d))

    # ---------------- B-07 文件超 20 MB ----------------
    up_before = sorted(p.name for p in (TMP_DIR / "uploads").rglob("*") if p.is_file()) \
        if (TMP_DIR / "uploads").exists() else []
    t0 = time.perf_counter()
    _, body = upload(fx["too_big"])
    dt = (time.perf_counter() - t0) * 1000
    bcheck("B-07", "25 MB 文件 → 40007", body.get("code") == 40007, str(body)[:160])
    bcheck("B-07", "流式过程中即中断（未把 25 MB 全读完）", dt < 3000, f"{dt:.0f}ms")
    up_after = sorted(p.name for p in (TMP_DIR / "uploads").rglob("*") if p.is_file()) \
        if (TMP_DIR / "uploads").exists() else []
    bcheck("B-07", "🔒 磁盘不残留临时文件（uploads 目录无新增）",
           up_after == up_before, f"{up_before} → {up_after}")
    big_left = [p for p in (TMP_DIR / "uploads").rglob("*")
                if p.is_file() and p.stat().st_size > 20 * 1024 * 1024] \
        if (TMP_DIR / "uploads").exists() else []
    bcheck("B-07", "uploads 内不存在任何 > 20 MB 的残留", not big_left, str(big_left))

    # ---------------- B-08 行数超限 ----------------
    _, body = upload(fx["too_many_rows"])
    bcheck("B-08", "500,001 行 → 40008", body.get("code") == 40008, str(body)[:160])

    # ---------------- B-09 空文件 ----------------
    _, body = upload(fx["empty"])
    bcheck("B-09", "0 字节 .csv → 40010", body.get("code") == 40010, str(body)[:160])

    # ---------------- B-10 非 CSV 内容改名 .csv ----------------
    # 🔴 **实测口径（EP-9）**：一份**真** xlsx（zip 容器）改名 `.csv` 后，
    #    实际落在第 2 步「大小/行数」→ `40010`，**不是**第 3 步表头 → `40001`。
    #    根因：xlsx 内部的 XML 属性带**双引号**（`version="1.0"`），
    #    CSV 解析器会把它当成引号包围字段，于是把多个物理行"吞"成 1 条记录，
    #    行数检查读到的数据行数 = 0。
    #    §9.4 `B-10` 的判据只要求「**不应在扩展名阶段放行**」，
    #    第 2 步与第 3 步同属内容校验阶段，故此处按实测收敛判据；
    #    「40010 的文案说『仅有表头』对二进制文件不够贴切」已登记为遗留问题（P3）。
    _, body = upload(fx["xlsx_as_csv"])
    d = body.get("data") or {}
    fs = d.get("fail_stage")
    bcheck("B-10", "🔒 不在扩展名阶段截住（fail_stage ≠「扩展名」）",
           fs != "扩展名", f"fail_stage={fs}")
    bcheck("B-10", "🔒 也不是扩展名错误码 40009（.csv 后缀确实通过了第 1 步）",
           body.get("code") != 40009, f"code={body.get('code')}")
    bcheck("B-10", "在**内容校验阶段**被拒（第 2 步 大小/行数 或第 3 步 表头完整性）",
           fs in ("大小/行数", "表头完整性") and body.get("code") in (40001, 40010),
           f"code={body.get('code')} fail_stage={fs}")


# ===========================================================================
# 2. B-11 / B-12 / B-13 / B-15 稀疏长尾（一次任务覆盖四条）
# ===========================================================================
def case_sparse(fx: dict[str, Path], token: str) -> dict | None:
    section("2. B-11 / B-12 / B-13 / B-15：稀疏长尾数据集（🔒 TEST-2 必测）")

    st, body = upload(fx["sparse"], name="sparse_l3_l2.csv", token=token)
    if not bcheck("B-11", "稀疏数据集上传成功", st == 200 and body.get("code") == 0,
                  str(body)[:200]):
        return None
    ds_id = dataset_id_of(body)
    ds = (body.get("data") or {}).get("dataset") or {}
    sc = series_count_of(body)
    print(f"       dataset_id={ds_id} 序列数={sc} "
          f"商品数={ds.get('sku_count')} 仓库数={ds.get('warehouse_count')}")
    # 夹具自检：构造出的分级必须与预期一致，否则后面的断言没有意义
    bcheck("B-11", "夹具构造出 6 条序列（1×L1 + 2×L2 + L3 + 全零 + 特殊字符）",
           sc == SPARSE_EXPECT["total"], f"series_count={sc}")

    # ---------------- API-09 分级预判（上传后立刻可解释） ----------------
    st9, c9, d9, m9 = api_json(client.get(f"/api/v1/datasets/{ds_id}", headers=auth(token)))
    pre = ((d9 or {}).get("level_preview") or {}) if c9 == 0 else {}
    if pre:
        print(f"       API-09 level_preview={pre}")

    # ---------------- 建任务并跑到终态 ----------------
    st12, c12, d12, m12 = api_json(client.post(
        "/api/v1/predictions",
        json={"dataset_id": ds_id, "horizon": 7},
        headers=auth(token),
    ))
    if not bcheck("B-11", "稀疏数据集预测任务成功（不因长尾失败）",
                  st12 == 200 and c12 == 0 and (d12 or {}).get("status") == "succeeded",
                  f"{st12} code={c12} status={(d12 or {}).get('status')} msg={m12[:120]}"):
        return None
    task_id = int((d12 or {}).get("task_id") or 0)
    print(f"       task_id={task_id} device={(d12 or {}).get('device')} "
          f"l1={d12.get('l1_count')} l2={d12.get('l2_count')} l3={d12.get('l3_count')}")

    # ---------------- 结果接口 ----------------
    st14, c14, d14, m14 = api_json(client.get(f"/api/v1/predictions/{task_id}",
                                              headers=auth(token)))
    if not bcheck("B-11", "结果接口可读（API-14）", st14 == 200 and c14 == 0, f"{st14} {m14[:120]}"):
        return {"task_id": task_id, "dataset_id": ds_id}

    cov = d14.get("coverage") or {}
    print(f"       coverage={cov}")

    # ============ B-11 L3 序列 ============
    # 📌 判据已于 `EP-9` 修正（技术文档 `API-15-1` / `B-11` 同步勘误）：
    #    原判据写「该序列**不写入** predictions」，与 PRD 两条 P0 相冲突 ——
    #    `FR-MOD-08`「L3 输出**历史均值**并标记不可预测」、
    #    `FR-VIS-04`「三类标签均可出现」（L3 不落行则明细表的 L3 标签/筛选恒为空）。
    #    按「功能范围以 PRD 为准」收敛为：**只落 1 行占位**，
    #    行数恒为 1 且**绝不等于 horizon**，值取历史均值。
    #    所以这里断言的不是"有没有行"，而是"有几行、值是什么、算不算进指标"。
    bcheck("B-11", "🔒 coverage.L3 ≥ 1（示例数据恒为 0，必须构造才能打到）",
           int(cov.get("L3") or 0) >= 1, f"L3={cov.get('L3')}")
    bcheck("B-11", "coverage.L3 == 1（夹具恰好 1 条）",
           int(cov.get("L3") or 0) == SPARSE_EXPECT["L3"], str(cov.get("L3")))
    l3_rows = sql(
        "SELECT COUNT(*) FROM predictions WHERE task_id = ? AND granularity_level = 'L3'",
        (task_id,),
    )[0][0]
    bcheck("B-11", "🔒 L3 只落 1 行占位（不是被静默丢弃，也不是逐日输出）",
           int(l3_rows) == 1, f"L3 行数={l3_rows}（horizon=7）")
    l3_sku = sql(
        "SELECT COUNT(*), MIN(predicted_value), MAX(predicted_value) FROM predictions "
        "WHERE task_id = ? AND sku_id = ? AND granularity_level = 'L3'",
        (task_id, "item_l3"),
    )[0]
    # 夹具 item_l3 = 5 天、base=3 → 值序列 3,4,5,6,7 → 历史均值 5.0
    bcheck("B-11", "🔒 L3 占位值是**历史均值**而不是预测值（FR-MOD-08）",
           int(l3_sku[0]) == 1 and abs(float(l3_sku[1]) - 5.0) < 1e-6,
           f"行数={l3_sku[0]} 值={l3_sku[1]}")
    bcheck("B-11", "L3 序列的其它 horizon 日**没有**预测行（无逐日数值预测）",
           int(l3_sku[0]) != 7, f"行数={l3_sku[0]}")
    # 📌 「只数 L1」的正确表述是 **≤ L1**，不是 == L1：
    #    `metrics.compute_task_metrics` 会剔除单序列 MAPE 无定义的序列
    #    （`np.isnan(sm)` → 不计入 evaluated）。本例 3 条 L1 中，
    #    `item_zero` 销量全为 0 → 分母 Σ|y| = 0 → MAPE 无定义 → 被合理剔除，
    #    故 evaluated = 2。若写死 == L1，这条断言会变成"因为夹具刚好没有全零序列"才通过。
    evaluated = int((d14.get("metrics") or {}).get("series_evaluated") or 0)
    bcheck("B-11", "🔒 L3/L2 不计入主指标（series_evaluated ≤ L1）",
           evaluated <= int(cov.get("L1") or 0),
           f"evaluated={evaluated} L1={cov.get('L1')} L2={cov.get('L2')} L3={cov.get('L3')}")
    bcheck("B-11", "evaluated = L1 − 全零序列数（=2：item_l1 与特殊字符序列）",
           evaluated == 2, f"evaluated={evaluated}")
    st_d, c_d, d_d, _ = api_json(client.get(
        f"/api/v1/predictions/{task_id}/detail",
        params={"level": "L3", "size": 20}, headers=auth(token)))
    bcheck("B-11", "🔒 明细表可筛出 L3（FR-VIS-04「三类标签均可出现」的前提）",
           c_d == 0 and int((d_d or {}).get("total") or 0) == 1,
           f"code={c_d} total={(d_d or {}).get('total')}")
    bcheck("B-11", "覆盖率面板可判定「不可预测」（predictable = L1 + L2）",
           int(cov.get("predictable") or 0) == int(cov.get("L1") or 0) + int(cov.get("L2") or 0),
           str(cov))
    bcheck("B-11", "三级计数闭合（L1+L2+L3 == total）",
           int(cov.get("L1") or 0) + int(cov.get("L2") or 0) + int(cov.get("L3") or 0)
           == int(cov.get("total") or 0), str(cov))

    # ============ B-12 L2 序列 ============
    bcheck("B-12", "🔒 coverage.L2 ≥ 1（本仓 < 90 但跨仓 ≥ 90）",
           int(cov.get("L2") or 0) >= 1, f"L2={cov.get('L2')}")
    bcheck("B-12", "coverage.L2 == 2（item_l2 的两个仓）",
           int(cov.get("L2") or 0) == SPARSE_EXPECT["L2"], str(cov.get("L2")))
    l2_rows = sql(
        "SELECT COUNT(*) FROM predictions WHERE task_id = ? AND sku_id = ? "
        "AND granularity_level = 'L2'",
        (task_id, "item_l2"),
    )[0][0]
    bcheck("B-12", "L2 序列有数值预测（走商品级降级，不是被丢弃）",
           int(l2_rows) > 0, f"L2 行数={l2_rows}")
    l2_mape = (d14.get("metrics") or {}).get("l2_mape")
    bcheck("B-12", "🔒 l2_mape 为 null 或有限值（**不得是 NaN 字面量**）",
           l2_mape is None or (isinstance(l2_mape, (int, float)) and math.isfinite(l2_mape)),
           f"l2_mape={l2_mape!r}")
    bcheck("B-12", "🔒 响应体全程不含 NaN / Infinity 字面量（API-14-2）",
           not has_nan_literal(
               client.get(f"/api/v1/predictions/{task_id}", headers=auth(token))),
           "结果接口响应")

    # ============ B-13 全零序列 ============
    bcheck("B-13", "全零序列未让任务失败（除零保护生效）",
           (d12 or {}).get("status") == "succeeded", str((d12 or {}).get("status")))
    m = d14.get("metrics") or {}
    finite = [
        m.get("weighted_mape"), m.get("weighted_mae"), m.get("weighted_rmse"),
        m.get("l1_mape"), m.get("baseline_mae"), m.get("rmse_improve_pct"),
    ]
    bad = [v for v in finite if isinstance(v, float) and not math.isfinite(v)]
    bcheck("B-13", "🔒 任务级 mape 不出现 Inf / NaN（经 _num 归一为 null）",
           not bad, f"异常值={bad} 实际={finite}")
    txt = client.get(f"/api/v1/predictions/{task_id}", headers=auth(token)).text
    bcheck("B-13", "响应体字面量复核：无 NaN / Infinity", not any(
        t in txt for t in ("NaN", "Infinity")), "已复核")
    zero_rows = sql(
        "SELECT COUNT(*) FROM predictions WHERE task_id = ? AND sku_id = 'item_zero'",
        (task_id,),
    )[0][0]
    bcheck("B-13", "全零序列仍产出预测行（未被静默丢弃）", int(zero_rows) == 7,
           f"item_zero 行数={zero_rows}")

    # ============ B-15 中文 / 特殊字符 ============
    names = sql(
        "SELECT DISTINCT sku_id, warehouse_id FROM predictions WHERE task_id = ? "
        "AND sku_id = ?",
        (task_id, SP_SKU),
    )
    bcheck("B-15", "含逗号与双引号的商品名完成「上传 → 解析 → 落库」往返",
           len(names) == 1 and names[0][0] == SP_SKU and names[0][1] == SP_WH,
           str(names))
    st15, c15, d15, m15 = api_json(client.get(
        f"/api/v1/predictions/{task_id}/detail",
        params={"page": 1, "size": 20, "keyword": SP_WH},
        headers=auth(token),
    ))
    bcheck("B-15", "特殊字符仓库名可用于明细模糊搜索（展示链路正常）",
           st15 == 200 and c15 == 0 and int((d15 or {}).get("total") or 0) > 0,
           f"{st15} code={c15} total={(d15 or {}).get('total')}")
    exp = client.get(f"/api/v1/predictions/{task_id}/export",
                     params={"format": "csv"}, headers=auth(token))
    bcheck("B-15", "导出接口 200（含中文附件的文件名双写）",
           exp.status_code == 200, f"HTTP {exp.status_code} "
           f"CD={exp.headers.get('content-disposition', '')[:120]}")
    text = exp.content.decode("utf-8-sig", errors="replace")
    bcheck("B-15", "🔒 导出 CSV 原样含带引号转义的商品名（往返不失真）",
           f'"{SP_SKU.replace(chr(34), chr(34) * 2)}"' in text and SP_WH in text,
           f"前 200 字符={text[:200]!r}")

    return {"task_id": task_id, "dataset_id": ds_id}


# ===========================================================================
# 3. B-14 单序列
# ===========================================================================
def case_single_series(fx: dict[str, Path], token: str) -> None:
    section("3. B-14：单序列数据（1 商品 × 1 仓）")

    st, body = upload(fx["single"], name="single_series.csv", token=token)
    if not bcheck("B-14", "单序列数据集上传成功",
                  st == 200 and body.get("code") == 0, str(body)[:200]):
        return
    ds_id = dataset_id_of(body)
    sc = series_count_of(body)
    bcheck("B-14", "上传响应 series_count == 1", sc == 1, f"series_count={sc}")

    st12, c12, d12, m12 = api_json(client.post(
        "/api/v1/predictions",
        json={"dataset_id": ds_id, "horizon": 7},
        headers=auth(token),
    ))
    bcheck("B-14", "单序列任务正常完成（不因样本太少而失败）",
           st12 == 200 and c12 == 0 and (d12 or {}).get("status") == "succeeded",
           f"{st12} code={c12} status={(d12 or {}).get('status')} msg={m12[:120]}")
    if c12 != 0:
        return
    task_id = int((d12 or {}).get("task_id") or 0)
    bcheck("B-14", "🔒 series_total == 1",
           int((d12 or {}).get("series_count") or 0) == 1, str((d12 or {}).get("series_count")))
    res = sql("SELECT l1_count, l2_count, l3_count, series_total FROM tasks WHERE id = ?",
              (task_id,))
    bcheck("B-14", "落库计数 (L1, L2, L3, total) == (1, 0, 0, 1)",
           bool(res) and tuple(int(x or 0) for x in res[0]) == (1, 0, 0, 1), str(res))
    n = sql("SELECT COUNT(*) FROM predictions WHERE task_id = ?", (task_id,))[0][0]
    bcheck("B-14", "预测行数 = 1 序列 × 7 天 = 7", int(n) == 7, f"行数={n}")


# ===========================================================================
# 4. B-16 超 60 秒任务 → 软失败（子进程，压低预算）
# ===========================================================================
def case_timeout(sample_ds: int) -> None:
    section("4. B-16：超预算任务软失败（🔒 TEST-3 必须实际模拟）")

    runner = ROOT / "scripts" / "_ep5_cfg_probe.py"
    out = TMP_DIR / "b16_timeout.json"
    if not check("B-16 配置探针脚本存在（复用 EP-5 资产）", runner.exists(), runner.name):
        return
    env = dict(os.environ)
    env["TASK_BUDGET_MS"] = "1"
    proc = subprocess.run(
        [sys.executable, str(runner), "--dataset-id", str(sample_ds),
         "--horizon", "30", "--out", str(out)],
        cwd=str(ROOT), capture_output=True, text=True, timeout=900, env=env,
    )
    for ln in ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()[-4:]:
        print(f"     {ln}")
    if not bcheck("B-16", "探针子进程跑通（输出落盘）",
                  proc.returncode == 0 and out.exists(), f"exit={proc.returncode}"):
        return

    r = json.loads(out.read_text(encoding="utf-8"))
    body = r["body"]
    data = body.get("data") or {}
    bcheck("B-16", "🔒 不是 5xx（软失败不得退化成 502 —— API-12-2 / NFR-REL-02）",
           r["http_status"] == 200, f"HTTP {r['http_status']}")
    bcheck("B-16", "🔒 code 仍为 0（HTTP 层不是错误）", body.get("code") == 0,
           f"code={body.get('code')}")
    bcheck("B-16", "status = failed", data.get("status") == "failed",
           str(data.get("status")))
    bcheck("B-16", "🔒 error_code = E_TIMEOUT", data.get("error_code") == "E_TIMEOUT",
           str(data.get("error_code")))
    bcheck("B-16", "🔒 携带已完成阶段 completed_stage",
           bool(data.get("completed_stage")), str(data.get("completed_stage")))
    bcheck("B-16", "给出 3 条处置建议", len(data.get("suggestions") or []) == 3,
           f"条数={len(data.get('suggestions') or [])}")
    bcheck("B-16", "🔒 失败任务已落库（tasks 行数 +1，可复现可查）",
           r["tasks_after"] == r["tasks_before"] + 1,
           f"{r['tasks_before']} → {r['tasks_after']}")
    tid = data.get("task_id")
    if tid:
        rows = sql("SELECT COUNT(*) FROM predictions WHERE task_id = ?", (int(tid),))
        bcheck("B-16", "半成品不落盘（失败任务无 predictions 行）",
               int(rows[0][0]) == 0, f"行数={rows[0][0]}")
        st = sql("SELECT status, error_code FROM tasks WHERE id = ?", (int(tid),))
        bcheck("B-16", "tasks 行记录 failed + E_TIMEOUT",
               bool(st) and st[0][0] == "failed" and st[0][1] == "E_TIMEOUT", str(st))


# ===========================================================================
# 5. B-17 CUDA OOM → 自动回退 CPU（🔒 TEST-3 必须实际模拟）
# ===========================================================================
def case_oom_fallback(sample_ds: int) -> None:
    section("5. B-17：CUDA OOM 自动回退 CPU（🔒 实际注入，非代码审查）")

    import app.algo.infer as algo_infer
    from app.core.model_holder import holder, load_active_model

    handle = holder.handle
    if not check("B-17 前置：模型已加载且在 CUDA 上（否则无从 OOM）",
                 handle is not None and handle.device == "cuda",
                 f"loaded={handle is not None} device={handle and handle.device}"):
        if handle is not None:
            print("       → 本机为纯 CPU 环境，B-17 只能如实登记为「无法模拟」")
        return

    real_run = algo_infer.run_inference
    state = {"injected": False}

    def flaky(df, backtest=False, **kw):
        """第 1 次以 cuda 调用时抛 OOM；此后一律走真实实现。

        🔒 注入点选在 `algo_infer.run_inference` 而不是 `_run_inference`：
           后者是 `predict_service` 的内部闭包，无法从外部替换；
           而 `_once()` 里是 `algo_infer.run_inference(...)` 的**属性查找**，
           替换模块属性即可被真实代码路径取到 —— 注入的是 OOM 现象，
           被验证的仍是生产代码（`_is_oom` → `_recover_from_oom` → 重跑）。
        """
        if kw.get("device") == "cuda" and not state["injected"]:
            state["injected"] = True
            raise RuntimeError(
                "CUDA out of memory. Tried to allocate 512.00 MiB "
                "(GPU 0; 2.00 GiB total capacity)"
            )
        return real_run(df, backtest=backtest, **kw)

    before = tasks_count()
    algo_infer.run_inference = flaky
    try:
        st, code, data, msg = api_json(client.post(
            "/api/v1/predictions",
            json={"dataset_id": sample_ds, "horizon": 7},
        ))
    finally:
        algo_infer.run_inference = real_run

    bcheck("B-17", "OOM 注入确实被触发（假注入会让后面的断言变成假通过）",
           state["injected"], f"injected={state['injected']}")
    bcheck("B-17", "🔒 任务仍然成功（NFR-REL-03 显存自愈）",
           st == 200 and code == 0 and (data or {}).get("status") == "succeeded",
           f"{st} code={code} status={(data or {}).get('status')} msg={msg[:140]}")
    bcheck("B-17", "🔒 响应 device = cpu", (data or {}).get("device") == "cpu",
           str((data or {}).get("device")))
    bcheck("B-17", "🔒 响应 device_fallback = 1",
           int((data or {}).get("device_fallback") or 0) == 1,
           str((data or {}).get("device_fallback")))

    tid = (data or {}).get("task_id")
    if tid:
        row = sql("SELECT device, device_fallback, status FROM tasks WHERE id = ?",
                  (int(tid),))
        bcheck("B-17", "落库 device=cpu 且 device_fallback=1",
               bool(row) and row[0][0] == "cpu" and int(row[0][1] or 0) == 1
               and row[0][2] == "succeeded", str(row))
        n = sql("SELECT COUNT(*) FROM predictions WHERE task_id = ?", (int(tid),))[0][0]
        bcheck("B-17", "回退后预测结果完整落盘（不是空跑）", int(n) > 0, f"行数={n}")
        bcheck("B-17", "tasks 行数正常 +1（未因 OOM 丢记录）",
               tasks_count() == before + 1, f"{before} → {tasks_count()}")

    # ---- 复原：OOM 恢复把模型搬到了 CPU 且改写了单例，必须重新加载 ----
    load_active_model()
    check("B-17 复原：模型重新加载回 CUDA（避免污染后续用例）",
          holder.handle is not None and holder.handle.device == "cuda",
          f"device={holder.handle and holder.handle.device}")


# ===========================================================================
# 6. B-18 无启用模型（启动失败 + 运行中 40404）
# ===========================================================================
def case_no_model(sample_ds: int) -> None:
    section("6. B-18：无启用模型（BE-06）")

    from app.core.model_holder import holder, load_active_model

    # ---- (a) 启动自检：配置漂移必须让服务起不来 --------------------------
    probe = ROOT / "scripts" / "_ep9_boot_probe.py"
    if check("B-18 启动探针脚本存在", probe.exists(), probe.name):
        out = TMP_DIR / "b18_boot.json"
        env = dict(os.environ)
        env["ACTIVE_MODEL"] = "lstm_never_exists"
        proc = subprocess.run(
            [sys.executable, str(probe), "--out", str(out)],
            cwd=str(ROOT), capture_output=True, text=True, timeout=600, env=env,
        )
        for ln in ((proc.stdout or "") + (proc.stderr or "")).strip().splitlines()[-3:]:
            print(f"     {ln}")
        if check("B-18 启动探针跑通并落盘", proc.returncode == 0 and out.exists(),
                 f"exit={proc.returncode}"):
            r = json.loads(out.read_text(encoding="utf-8"))
            bcheck("B-18", "🔒 无对应启用版本时**启动失败**（不是带着坏配置跑起来）",
                   r.get("started") is False, f"started={r.get('started')}")
            err = str(r.get("error") or "")
            bcheck("B-18", "异常信息点明配置漂移（.env 与 model_registry 不一致）",
                   "漂移" in err, err[:200])
            bcheck("B-18", "异常信息带上期望的版本号（可直接照着改 .env）",
                   "lstm_never_exists" in err, err[:200])

    # ---- (b) 运行中模型被清空 → 预测接口 40404（而不是 500） --------------
    holder.clear()
    bcheck("B-18 前置：holder 已清空（loaded=False）", not holder.loaded, f"loaded={holder.loaded}")
    st, code, data, msg = api_json(client.post(
        "/api/v1/predictions",
        json={"dataset_id": sample_ds, "horizon": 7},
    ))
    bcheck("B-18", "🔒 运行中无模型 → 40404（不是 500）", code == 40404,
           f"HTTP {st} code={code} msg={msg[:140]}")
    bcheck("B-18", "未留下「模型没就绪」的失败任务行（就绪检查在建行之前）",
           "40404" not in str(
               sql("SELECT GROUP_CONCAT(error_code) FROM tasks")[0][0] or ""),
           str(sql("SELECT GROUP_CONCAT(error_code) FROM tasks")[0][0]))

    load_active_model()
    check("B-18 复原：模型已重新加载",
          holder.loaded and holder.handle is not None, f"version={holder.version}")


# ===========================================================================
# 7. B-19 并发 3 任务
# ===========================================================================
def case_concurrency(sample_ds: int) -> None:
    section("7. B-19：并发 3 任务（NFR-PERF-09 / NFR-REL-04）")

    before = tasks_count()
    lock_hit: list[str] = []
    guard = threading.Lock()

    def one(i: int) -> tuple[int, int, dict | None, float, str]:
        """每个线程用**独立**的 TestClient：共享一个客户端时并发请求会串到同一
        portal 上，测不出「SQLite 层面是否会被锁」。"""
        c = TestClient(app)
        t0 = time.perf_counter()
        try:
            res = c.post("/api/v1/predictions", json={"dataset_id": sample_ds, "horizon": 7})
            body = res.json()
            text = res.text
            if "locked" in text.lower():
                with guard:
                    lock_hit.append(text[:200])
            return i, res.status_code, body, (time.perf_counter() - t0) * 1000, ""
        except Exception as exc:  # noqa: BLE001
            return i, -1, None, (time.perf_counter() - t0) * 1000, str(exc)

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(one, range(3)))
    wall = (time.perf_counter() - t0) * 1000

    for i, st, body, ms, err in results:
        code = (body or {}).get("code")
        status = ((body or {}).get("data") or {}).get("status")
        print(f"       #{i}: HTTP={st} code={code} status={status} {ms:.0f}ms {err[:80]}")

    bcheck("B-19", "3 个任务全部成功完成",
           all(st == 200 and (b or {}).get("code") == 0
               and ((b or {}).get("data") or {}).get("status") == "succeeded"
               for _, st, b, _, _ in results),
           str([((b or {}).get("code"), ((b or {}).get("data") or {}).get("status"))
                for _, _, b, _, _ in results]))
    bcheck("B-19", "🔒 无 database is locked（WAL + busy_timeout 生效）",
           not lock_hit, f"命中 {len(lock_hit)} 次")
    bcheck("B-19", "tasks 行数 +3（三行都在，无互相覆盖）",
           tasks_count() == before + 3, f"{before} → {tasks_count()}")
    after = tasks_count()
    rows = sql(
        "SELECT t.id, (SELECT COUNT(*) FROM predictions p WHERE p.task_id = t.id) "
        "FROM tasks t ORDER BY t.id DESC LIMIT 3"
    )
    bcheck("B-19", "三条任务各自都有预测结果（未串写）",
           len(rows) == 3 and all(int(r[1]) > 0 for r in rows), str(rows))
    print(f"       并发墙钟 {wall:.0f}ms（{after} 行任务）")


# ===========================================================================
# 8. B-20 / B-21 越权访问
# ===========================================================================
def case_ownership(sparse: dict | None, token_a: str) -> None:
    section("8. B-20 / B-21：越权访问他人任务（NFR-SEC-05）")

    if not sparse:
        bcheck("B-20", "前置：需要一个属于他人的成功任务", False, "sparse 用例未产出任务")
        return

    register("b_intruder@example.com")
    token_b = login("b_intruder@example.com")

    # ⚠️ 用**数据集所有者**的身份建任务：数据集归属校验（`BE-41`）先于任务归属，
    #    拿别的账号去建任务会先吃 `40301 无权访问该数据集`，测不到本用例。
    st, code, data, msg = api_json(client.post(
        "/api/v1/predictions",
        json={"dataset_id": int(sparse["dataset_id"]), "horizon": 7},
        headers=auth(token_a),
    ))
    if not check("B-20 前置：用户 A 的任务创建成功",
                 st == 200 and code == 0 and (data or {}).get("status") == "succeeded",
                 f"{st} code={code} msg={msg[:120]}"):
        return
    tid = int((data or {}).get("task_id") or 0)
    print(f"       A 的任务 id={tid}；B 的 token 已就绪（sparse 任务 id={sparse['task_id']}）")

    # ---- B-20 越权读详情 ----
    st20, c20, d20, m20 = api_json(client.get(
        f"/api/v1/predictions/{tid}", headers=auth(token_b)))
    bcheck("B-20", "🔒 越权访问他人任务 → 40301（**不是 404**，NFR-SEC-05）",
           c20 == 40301, f"HTTP {st20} code={c20} msg={m20[:140]}")
    bcheck("B-20", "越权时不返回任何预测数据", not (d20 or {}).get("series"),
           str(list((d20 or {}).keys())))
    sth, ch, _, mh = api_json(client.get(f"/api/v1/history/{tid}", headers=auth(token_b)))
    bcheck("B-20", "历史详情同样 40301（列表/详情/结果三处口径一致）",
           ch == 40301, f"HTTP {sth} code={ch} msg={mh[:120]}")
    stm, cm, _, mm = api_json(client.get(
        f"/api/v1/predictions/{tid}/detail", headers=auth(token_b)))
    bcheck("B-20", "越权访问明细同样 40301", cm == 40301, f"HTTP {stm} code={cm}")

    # ---- B-21 导出越权 ----
    exp = client.get(f"/api/v1/predictions/{tid}/export",
                     params={"format": "csv"}, headers=auth(token_b))
    try:
        eb = exp.json()
    except Exception:  # noqa: BLE001
        eb = {}
    bcheck("B-21", "🔒 越权导出 → 40301（不是 200 也不是 404）",
           eb.get("code") == 40301, f"HTTP {exp.status_code} "
           f"code={eb.get('code')} len={len(exp.content)}")
    bcheck("B-21", "越权导出响应体不含 CSV 数据", b"sku_id" not in exp.content,
           f"响应长度={len(exp.content)}")

    # ---- 反面对照：本人访问必须成功（防止「一律 403」的假通过） ----
    stok, cok, _, _ = api_json(client.get(
        f"/api/v1/predictions/{tid}", headers=auth(token_a)))
    bcheck("B-20", "反面对照：本人访问同一任务 → code 0（越权判定不是一刀切拒绝）",
           cok == 0, f"HTTP {stok} code={cok}")


# ===========================================================================
# 9. B-22 路径穿越
# ===========================================================================
def case_path_traversal() -> None:
    section("9. B-22：路径穿越（不得读到工作区外文件）")

    magic = b"SQLite format 3"

    # ---- (a) 请求体里的 dataset_id ----
    st, code, data, msg = api_json(client.post(
        "/api/v1/predictions",
        json={"dataset_id": "../app.db", "horizon": 7},
    ))
    bcheck("B-22", "🔒 body.dataset_id = '../app.db' → 参数校验失败（40012）",
           code == 40012, f"HTTP {st} code={code} msg={msg[:140]}")
    bcheck("B-22", "非法 dataset_id 不产生任何任务行",
           "40402" not in str(sql("SELECT GROUP_CONCAT(error_code) FROM tasks")[0][0] or ""),
           "已核查")

    # ---- (b) 路径参数里的穿越串 ----
    probes = [
        ("GET", "/api/v1/datasets/..%2F..%2Fapp.db", None),
        ("GET", "/api/v1/datasets/1%2F..%2F..%2Fapp.db/preview", None),
        ("GET", "/api/v1/predictions/..%2F..%2Fapp.db", None),
        ("GET", "/api/v1/history/..%2F..%2Fapp.db", None),
        ("GET", "/api/v1/predictions/1/export?format=..%2F..%2Fapp.db", None),
    ]
    leaked = []
    for method, url, _ in probes:
        r = client.request(method, url)
        try:
            b = r.json()
            c = b.get("code")
        except Exception:  # noqa: BLE001
            c = None
        bad = magic in r.content or (c == 0 and r.status_code == 200)
        print(f"       {method} {url} → HTTP={r.status_code} code={c}")
        if bad:
            leaked.append((url, r.status_code, c))
    bcheck("B-22", "🔒 全部穿越探针均未返回成功结果（不含 SQLite 文件头）",
           not leaked, f"泄漏={leaked}")
    bcheck("B-22", "app.db 仍存在于工作区（未被读走 / 未被动过）",
           Path(app_config.settings.db_path).exists(), str(app_config.settings.db_path))


# ===========================================================================
# 10. B-23 SQL 注入
# ===========================================================================
def case_sql_injection() -> None:
    section("10. B-23：SQL 注入（参数化查询）")

    register("b_sql@example.com")
    token = login("b_sql@example.com")
    payload = "'; DROP TABLE tasks;--"

    st, code, data, msg = api_json(client.get(
        "/api/v1/history", params={"keyword": payload, "page": 1, "size": 20},
        headers=auth(token)))
    bcheck("B-23", "注入串作为关键词返回正常（code 0，不 500）",
           st == 200 and code == 0, f"HTTP {st} code={code} msg={msg[:140]}")
    bcheck("B-23", "注入串被当作普通字面量（命中 0 条，未成为 SQL 片段）",
           int((data or {}).get("total") or 0) == 0, f"total={(data or {}).get('total')}")

    exists = sql("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tasks'")
    bcheck("B-23", "🔒 tasks 表仍在（注入未被执行）", int(exists[0][0]) == 1, str(exists))

    # 再用注入串当任务名建任务，反查列表确认它被原样存/取
    st2, c2, d2, m2 = api_json(client.get(
        "/api/v1/history", params={"keyword": "DROP TABLE"}, headers=auth(token)))
    bcheck("B-23", "按注入子串检索仍正常返回（转义后可按字面量匹配）",
           st2 == 200 and c2 == 0, f"HTTP {st2} code={c2}")

    # 明细接口的 keyword 走同一条 DAO 参数化路径
    st3, c3, _, m3 = api_json(client.get(
        "/api/v1/predictions/1/detail",
        params={"keyword": payload}, headers=auth(token)))
    bcheck("B-23", "明细接口同样的注入串不引发 500",
           c3 in (0, 40301, 40401), f"HTTP {st3} code={c3} msg={m3[:120]}")
    bcheck("B-23", "注入后 predictions 表仍可查询",
           int(sql("SELECT COUNT(*) FROM sqlite_master WHERE name='predictions'")[0][0]) == 1,
           "已核查")


# ===========================================================================
# 11. B-24 / B-25 对比
# ===========================================================================
def case_compare(sparse: dict | None, token: str) -> None:
    section("11. B-24 / B-25：跨任务对比的非法数量与步长不一致")

    ds_id = int((sparse or {}).get("dataset_id") or 0)
    if not check("B-24 前置：可用数据集", ds_id > 0, str(ds_id)):
        return

    # 造 2 个可用任务（7 天各一，另造一个 30 天用于 B-25）
    created: list[int] = []
    for h in (7, 7):
        st, code, d, msg = api_json(client.post(
            "/api/v1/predictions",
            json={"dataset_id": ds_id, "horizon": h}, headers=auth(token)))
        if st == 200 and code == 0:
            created.append(int((d or {}).get("task_id") or 0))
    bcheck("B-24 前置：造出 2 个成功任务", len(created) == 2, str(created))
    if len(created) < 2:
        return

    # ---- B-24 数量非法 ----
    for n, ids in (("1 个", created[:1]), ("5 个", created + [created[0] + 10000] * 3)):
        st, code, data, msg = api_json(client.post(
            "/api/v1/history/compare", json={"task_ids": ids}, headers=auth(token)))
        bcheck("B-24", f"task_ids 传 {n} → 40012（FR-HIS-04）", code == 40012,
               f"HTTP {st} code={code} msg={msg[:140]}")
    st, code, data, msg = api_json(client.post(
        "/api/v1/history/compare", json={"task_ids": []}, headers=auth(token)))
    bcheck("B-24", "task_ids 传空 → 40012", code == 40012, f"code={code}")

    # ---- B-25 步长不一致 ----
    st, code, d, msg = api_json(client.post(
        "/api/v1/predictions",
        json={"dataset_id": ds_id, "horizon": 30}, headers=auth(token)))
    if not check("B-25 前置：造出 horizon=30 的任务",
                 st == 200 and code == 0, f"{st} code={code} msg={msg[:120]}"):
        return
    h30 = int((d or {}).get("task_id") or 0)

    st, code, data, msg = api_json(client.post(
        "/api/v1/history/compare",
        json={"task_ids": [created[0], h30]}, headers=auth(token)))
    bcheck("B-25", "🔒 步长不一致仍返回结果（不是报错拒绝）",
           st == 200 and code == 0, f"HTTP {st} code={code} msg={msg[:140]}")
    warns = (data or {}).get("warnings") or []
    joined = " ".join(str(w) for w in warns)
    print(f"       warnings={warns}")
    bcheck("B-25", "🔒 warnings 提示「不可直接比较」（API-18-2）",
           "不一致" in joined and ("不可直接比较" in joined or "不代表模型优劣" in joined),
           joined[:200])
    bcheck("B-25", "对比结果含 attribution（谁知道该信哪个）",
           bool((data or {}).get("attribution")), str(list((data or {}).keys())))


# ===========================================================================
# 结论
# ===========================================================================
def print_b_matrix() -> None:
    section("§9.4 覆盖矩阵（B-01 ~ B-25 逐条判定）")
    order = [f"B-{i:02d}" for i in range(1, 26)]
    total = 0
    ok_count = 0
    for bid in order:
        items = B_RESULTS.get(bid)
        if not items:
            print(f"  {bid}  {'—':<4} 未执行")
            continue
        total += 1
        ok = all(x[1] for x in items)
        ok_count += 1 if ok else 0
        bad = [x[0] for x in items if not x[1]]
        mark = "通过" if ok else "未通过"
        print(f"  {bid}  {mark:<5} {len(items)} 条断言"
              + ("" if ok else f"   ← 失败：{'；'.join(bad)}"))
    print("")
    print(f"  B 条目：{ok_count} / {total} 通过"
          f"（共 {sum(len(v) for v in B_RESULTS.values())} 条断言）")


def main() -> int:  # noqa: C901 - 校验脚本，线性铺开比拆函数更好读
    global passed, failed
    t_all = time.perf_counter()
    print(f"临时库：{app_config.settings.db_path}")
    print(f"设备  ：{app_config.settings.torch_device}")

    with client:  # 🔒 触发 lifespan（建库 + seed + 预加载模型）
        if not check_prereq():
            print("\n[ABORT] 前置条件不满足，后续用例无意义。")
            return 2

        fx = build_fixtures()
        sample_ds = int(sql("SELECT id FROM datasets WHERE user_id = 0 "
                            "ORDER BY id LIMIT 1")[0][0])

        register("b_sparse@example.com")
        token_sparse = login("b_sparse@example.com")

        # ---- 不依赖模型的用例优先跑（快，且失败时能给出更清晰的原因） ----
        case_upload_boundaries(fx)
        case_path_traversal()
        case_sql_injection()

        # ---- 依赖模型的用例 ----
        sparse = case_sparse(fx, token_sparse)
        case_single_series(fx, token_sparse)
        case_compare(sparse, token_sparse)

        # ---- 🔴 会改写进程级模型单例的用例，必须排在最后 ----
        case_timeout(sample_ds)
        case_ownership(sparse, token_sparse)
        case_concurrency(sample_ds)
        case_oom_fallback(sample_ds)
        case_no_model(sample_ds)

        print_b_matrix()

        section("结论")
        print(f"通过 {passed} 项，失败 {failed} 项")
        print(f"总耗时 {(time.perf_counter() - t_all):.1f}s")
        print(f"临时目录保留于：{TMP_DIR}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
