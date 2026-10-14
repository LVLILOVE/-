"""
=============================================================================
数据集接口（`API-06` ~ `API-11` + 断档处置）
-----------------------------------------------------------------------------
版本     : V1.0（EP-4）
依据文档 : 《开发技术文档 V1.0》§5.5（`API-06` ~ `API-11`）、§2.2（`datasets.py` 文件划分）
           《PRD V1.0》`FR-UPL-01` ~ `FR-UPL-15`、`FR-USR-08`
           《UI/UX 设计文档 V1.0》§8.1 `UX-P05`（拖拽 / 五类错误 / 预览 / 模板下载）
-----------------------------------------------------------------------------
| 编号 | 方法 | 路径 | 鉴权 | 用途 |
|---|---|---|---|---|
| `API-06` | POST   | `/datasets`                     | 游客可（`OptionalUserId`） | 上传 + 7 步校验 + 落盘 |
| `API-07` | GET    | `/datasets/sample`              | 游客可（`OptionalUserId`） | 一键加载示例数据（幂等） |
| `API-08` | GET    | `/datasets/template`            | 否                        | 下载标准 CSV 模板 |
| `API-09` | GET    | `/datasets/{dataset_id}`        | 游客可（`OptionalUserId`） | 数据集详情 + 分级预判 |
| `API-10` | GET    | `/datasets/{dataset_id}/preview`| 游客可（`OptionalUserId`） | 数据预览（支持搜索） |
| `API-11` | GET    | `/datasets/{dataset_id}/errors` | 游客可（`OptionalUserId`） | 错误明细 CSV 下载 |
| ——       | POST   | `/datasets/gap`                 | 游客可（`OptionalUserId`） | 断档处置（`FR-UPL-13`） |

🔒 **路由注册顺序**（`BE-39` 同型的坑）
    `/datasets/sample`、`/datasets/template`、`/datasets/gap` 必须注册在
    `/datasets/{dataset_id}` **之前**。否则 FastAPI 会把字面量 `sample`
    当作 `dataset_id` 去解析，直接抛参数校验失败（`40012`）而不是进入业务逻辑。
    `scripts/verify_ep4.py` 用源码顺序守卫这条。

⚠️ **为什么 `API-09` / `API-10` / `API-11` 也用 `OptionalUserId`**（`EP-4` 裁定 B）
    技术文档 §5.3 的接口表把它们标为「鉴权 = 是」，但同一份文档的
    `DOD-EP4` 与 `FR-USR-08` 要求「游客未登录可完成上传并跳到参数页」，
    而参数页 `UX-P06` 的分级预判 / 预览正依赖 `API-09` / `API-10`；
    §4.3 `BE-41` 又写明「游客数据集匿名共享，**任何调用者**均可用」。
    三者取交集只有一种自洽解：这三个接口用 `OptionalUserId`，
    由 `BE-41` 的归属判定守住真实用户之间的隔离。已登记为偏离项。

职责边界（`BE-04`）：本文件只做「取参数 → 调 service → 组响应」。
  文件流（`UploadFile`）的消费属 HTTP 层职责，故留在本文件；
  `services/dataset_service.py` 只接受路径，不 import fastapi。
=============================================================================
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, Literal

import aiofiles
from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.core import config
from app.core.deps import DbSession, OptionalUserId
from app.core.errors import BizError, ErrorCode
from app.schemas import (
    ApiResponse,
    DatasetDetailResponse,
    DatasetPreview,
    ResolveGapRequest,
    UploadDatasetResponse,
)
from app.services import dataset_service

logger = logging.getLogger(__name__)
settings = config.settings

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _client_ip(request: Request) -> str | None:
    """客户端 IP（写审计日志用）。与 `api/v1/auth.py` 保持同一口径：
    不读可伪造的 `X-Forwarded-For`。"""
    return request.client.host if request.client else None


async def _stream_to_disk(
    path: Path, upload: UploadFile, *, limit_bytes: int, user_id: int
) -> int:
    """流式落盘（`FR-UPL-04` / `WS-4-01`）：分块读写，绝不把整文件读进内存。

    🔒 超限时**立即中断并删除半成品**：既避免磁盘被撑爆（`NFR-SEC-04`），
       也保证 `data/uploads/` 里不会留下一个「看起来完整」的超限文件。
    """
    total = 0
    try:
        async with aiofiles.open(path, "wb") as fh:
            while True:
                chunk = await upload.read(dataset_service.UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit_bytes:
                    raise BizError(
                        ErrorCode.FILE_TOO_LARGE,
                        f"文件超过大小上限 {settings.max_file_size_mb} MB，上传已中断",
                        {
                            "fail_stage": dataset_service.VALIDATE_ORDER[1],
                            "suggestion": (
                                f"当前已写入 {total / 1024 / 1024:.1f} MB。请拆分文件后重传，"
                                f"单文件不超过 {settings.max_file_size_mb} MB / "
                                f"{settings.max_rows:,} 行"
                            ),
                        },
                    )
                await fh.write(chunk)
    except BaseException:
        dataset_service.safe_unlink(path)
        raise
    finally:
        await upload.close()
    logger.debug("流式落盘完成 user=%s bytes=%s", user_id, total)
    return total


# =============================================================================
# `API-08` 下载标准 CSV 模板（必须在 `/{dataset_id}` 之前注册）
# =============================================================================
@router.get("/template", summary="下载标准 CSV 模板")
def download_template() -> Response:
    """`FR-UPL-08`：表头 + 2 行示例数据。

    🔒 带 UTF-8 BOM，保证 Excel 双击打开不乱码（`NFR-COMP-05` / `API-08-1`）。
       模板里的示例行是**合法数据**，用户直接提交也应通过校验 ——
       这是「模板可用性」的最低标准，故模板内容由 `services` 统一维护。
    """
    body = dataset_service.TEMPLATE_CSV_BODY.encode("utf-8-sig")
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="sales_template.csv"',
            "Content-Length": str(len(body)),
        },
    )


# =============================================================================
# `API-07` 加载内置示例数据（幂等）
# =============================================================================
@router.get("/sample", response_model=ApiResponse[UploadDatasetResponse], summary="加载示例数据")
async def load_sample(
    request: Request,
    user_id: OptionalUserId,
    db: DbSession,
) -> ApiResponse[UploadDatasetResponse]:
    """`FR-UPL-02`：一键加载菜鸟数据集抽样，让零基础用户也能跑通全流程。

    幂等：同一调用者重复调用返回**同一条** `datasets` 记录（`API-07-1`）。
    解析与分级属 CPU 密集，放线程池避免阻塞事件循环。
    """
    payload = await run_in_threadpool(
        dataset_service.load_sample, db, user_id=user_id, ip=_client_ip(request)
    )
    return ApiResponse.ok(
        UploadDatasetResponse.model_validate(payload), message="示例数据已就绪"
    )


# =============================================================================
# `API-06` 上传 CSV 数据集
# =============================================================================
@router.post("", response_model=ApiResponse[UploadDatasetResponse], summary="上传 CSV 数据集")
async def upload_dataset(
    request: Request,
    user_id: OptionalUserId,
    db: DbSession,
    file: Annotated[UploadFile, File(description="CSV 文件（≤20 MB，≤500,000 行）")],
    gap_action: Annotated[
        Literal["interpolate", "abort"] | None,
        Form(description="断档处置（FR-UPL-13）。首次上传不传，由用户在页面上显式选择"),
    ] = None,
) -> ApiResponse[UploadDatasetResponse]:
    """上传 + 七步校验 + 落盘 + 预览（`FR-UPL-01` ~ `FR-UPL-15`）。

    🔒 校验顺序严格按 `FR-UPL-09` / PRD §3.2.2，任一步失败即终止。
    🔒 扩展名（第 1 步）在**落盘之前**就拒绝；大小超限（第 2 步）在**流式过程中**
       中断 —— 这两种情形不产生 `datasets` 记录（`EP-4` 裁定 A）。

    耗时预算 ≤ 10 s（`NFR-PERF-02`）。
    """
    # ---------------- 第 1 步 · 扩展名（落盘前即拒） ----------------
    dataset_service.check_extension(file.filename)

    upload_id = dataset_service.new_upload_id()
    path = dataset_service.allocate_upload_path(user_id, upload_id)
    path.parent.mkdir(parents=True, exist_ok=True)

    # ---------------- 第 2 步 · 大小（流式中断） ----------------
    size_bytes = await _stream_to_disk(
        path,
        file,
        limit_bytes=settings.max_file_size_mb * 1024 * 1024,
        user_id=user_id,
    )

    # ---------------- 第 2~7 步 + 落库（CPU 密集，放线程池） ----------------
    payload = await run_in_threadpool(
        dataset_service.register_upload,
        db,
        path=path,
        size_bytes=size_bytes,
        original_name=file.filename or path.name,
        upload_id=upload_id,
        user_id=user_id,
        gap_action=gap_action,
        ip=_client_ip(request),
    )
    return ApiResponse.ok(
        UploadDatasetResponse.model_validate(payload), message="数据校验通过"
    )


# =============================================================================
# 断档处置（`FR-UPL-13`）
# =============================================================================
@router.post("/gap", response_model=ApiResponse[UploadDatasetResponse], summary="断档处置")
async def resolve_gap(
    request: Request,
    body: ResolveGapRequest,
    user_id: OptionalUserId,
    db: DbSession,
) -> ApiResponse[UploadDatasetResponse]:
    """`FR-UPL-13`：用户显式选择「自动插值补齐」或「放弃上传」。

    🔒 未选择前系统不得自动继续（`WS-4-05`）—— 故本接口只接受
       `action = interpolate | abort` 两个确定值，不存在「默认继续」。
    """
    payload = await run_in_threadpool(
        dataset_service.resolve_gap,
        db,
        dataset_id=body.dataset_id,
        action=body.action,
        user_id=user_id,
        ip=_client_ip(request),
    )
    if payload is None:
        return ApiResponse.ok(None, message="已放弃本次上传，原始数据未被采用")
    return ApiResponse.ok(
        UploadDatasetResponse.model_validate(payload), message="已按线性插值补齐缺失日期"
    )


# =============================================================================
# `API-09` 数据集详情（分级预判）
# =============================================================================
@router.get(
    "/{dataset_id}", response_model=ApiResponse[DatasetDetailResponse], summary="数据集详情"
)
async def dataset_detail(
    dataset_id: int,
    user_id: OptionalUserId,
    db: DbSession,
) -> ApiResponse[DatasetDetailResponse]:
    """参数页 `UX-P06` 的数据概要 + 序列分级预判（`API-09-1`）。

    ⚠️ `API-09-2`：本接口会执行一次完整读取与分级（50 万行约 2 秒）。
       参数页应在数据集加载后只调用一次，**不要**在每次参数变更时重复调用。
    """
    payload = await run_in_threadpool(
        dataset_service.get_detail, db, dataset_id=dataset_id, user_id=user_id
    )
    return ApiResponse.ok(DatasetDetailResponse.model_validate(payload))


# =============================================================================
# `API-10` 数据预览
# =============================================================================
@router.get(
    "/{dataset_id}/preview", response_model=ApiResponse[DatasetPreview], summary="数据预览"
)
async def dataset_preview(
    dataset_id: int,
    user_id: OptionalUserId,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=100, description="返回行数")] = 20,
    keyword: Annotated[
        str | None, Query(description="按商品 / 仓库模糊搜索（对应原型搜索框）")
    ] = None,
) -> ApiResponse[DatasetPreview]:
    """`FR-UPL-07`：让用户确认「系统读到的和我想的一致」。

    `total` 恒为数据集总行数（`API-10-1`），`shown` 为本次返回行数。
    """
    payload = await run_in_threadpool(
        dataset_service.get_preview,
        db,
        dataset_id=dataset_id,
        user_id=user_id,
        limit=limit,
        keyword=keyword,
    )
    return ApiResponse.ok(DatasetPreview.model_validate(payload))


# =============================================================================
# `API-11` 下载错误明细
# =============================================================================
@router.get("/{dataset_id}/errors", summary="下载错误明细")
async def download_errors(
    dataset_id: int,
    user_id: OptionalUserId,
    db: DbSession,
) -> Response:
    """`FR-UPL-06`：仅含不合格行，保留原始列并追加 `error_reason`（`API-11`）。

    🔒 临时文件位于 `data/exports/tmp/`，TTL 1 小时，与正式导出产物**分目录**
       （`JT-11` / `API-11-2`），由独立清理逻辑处理。
    """
    path, _filename = await run_in_threadpool(
        dataset_service.download_error_detail, db, dataset_id=dataset_id, user_id=user_id
    )
    content = await run_in_threadpool(path.read_bytes)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={
            # ⚠️ 文件名用纯 ASCII：HTTP 头是 latin-1 编码，塞中文会直接报错。
            #    展示用的中文名交给前端（content-disposition 里的 filename* 也可，
            #    但为兼容性取最稳的 ASCII 方案）。
            "Content-Disposition": f'attachment; filename="dataset_{dataset_id}_errors.csv"',
            "Content-Length": str(len(content)),
        },
    )
