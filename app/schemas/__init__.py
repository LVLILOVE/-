"""
=============================================================================
请求 / 响应模型（Pydantic v2）
-----------------------------------------------------------------------------
版本     : V1.0（EP-2 启用）
依据文档 : 《开发技术文档 V1.0》§2.2（目录结构）、§4.2（接口子层职责）
           《项目开发实施方案 V1.0》§2.2（`app/schemas/` 由 `code/backend/schemas.py` 拆分）
-----------------------------------------------------------------------------
🔒 单一真源：本包**不复制、不改写**任何模型，而是从 `code/backend/schemas.py`
   按绝对路径加载后整体 re-export。这样 `from app.schemas import RegisterRequest`
   与 `python scripts/verify_schemas.py` 读的是**同一个文件**。

为什么现在不拆
-----------------------------------------------------------------------------
`code/backend/schemas.py` 同时是三样东西：
  1. 运行期的模型定义；
  2. 交付资产 —— `scripts/verify_schemas.py` 直接 import 它（54 条断言）；
  3. 文档锚点 —— PRD / 技术文档按 `code/backend/schemas.py:行号` 引用
     （例如「`LoginRequest.email` 的类型是 `EmailStr`（`code/backend/schemas.py:176`）」）。
     ⚠️ 该锚点已两次漂移：`EP-4` 在 `ValidationErrorData` 增补 `dataset_id`（+5 行）
        把 `172` 推到 `177`；`EP-5` 在**中部**新增 `HorizonEstimate` /
        `estimate_by_horizon` / `CreateTaskResponse.timing` 三处后回到 `176`。
        教训：**行号锚点本身是不可靠的**——引用前先 grep 一次真实行号，
        宁可写类名 + 字段名也不要只写行号。

折叠/移动它会同时打断 ②③，属《实施方案》§5.7 的「18 项文档回写」范畴，
登记在 `EP-8`。若在此处先复制一份到 `app/schemas/`，会立刻出现两套定义、
字段各自漂移 —— 这正是本项目在原型阶段踩过的「两套数字」问题在类型层的翻版，
必须避免。

因此本文件只做**加载与转发**。`EP-8` 完成文档回写后，把 33 个模型按计划拆成
`common` / `auth` / `dataset` / `task` / `result` / `history` / `admin` 子模块，
届时把下面的加载逻辑换成常规 import 即可，调用方无需改动。
=============================================================================
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from app.core import config

_SOURCE: Path = config.settings.base_dir / "code" / "backend" / "schemas.py"
_MODULE_NAME = "app_schemas_source"          # 内部模块名，不出现在调用方

if not _SOURCE.exists():  # pragma: no cover - 仅在仓库不完整时触发
    raise ImportError(f"找不到模型源文件：{_SOURCE}")

if _MODULE_NAME in sys.modules:
    _mod = sys.modules[_MODULE_NAME]
else:
    _spec = importlib.util.spec_from_file_location(_MODULE_NAME, _SOURCE)
    if _spec is None or _spec.loader is None:  # pragma: no cover
        raise ImportError(f"无法加载模型源文件：{_SOURCE}")
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules[_MODULE_NAME] = _mod
    _spec.loader.exec_module(_mod)

# 需要转发的名字：全部非私有顶层对象（模型、常量、工具函数）
_SKIP = {
    "__builtins__",
    "__name__",
    "__doc__",
    "__file__",
    "__loader__",
    "__spec__",
    "__package__",
    "__annotations__",
}
_EXPORTED = [k for k in vars(_mod) if not k.startswith("_") and k not in _SKIP]

globals().update({k: getattr(_mod, k) for k in _EXPORTED})
__all__ = _EXPORTED

# 启动即自检：确保 EP-2 依赖的关键模型确实被转发过来（防止源文件被改名后静默失灵）
_REQUIRED = (
    "ApiResponse",
    "Paginated",
    "RegisterRequest",
    "RegisterResponse",
    "LoginRequest",
    "LoginResponse",
    "UserProfile",
    "UpdateUserRequest",
    "JwtPayload",
    "TOKEN_VERSION_DEFAULT",
    "BCRYPT_MAX_BYTES",
    "PASSWORD_MAX_CHARS",
)
_missing = [n for n in _REQUIRED if n not in globals()]
if _missing:  # pragma: no cover - 仅在模型被误删时触发
    raise ImportError(f"code/backend/schemas.py 缺少必需模型：{_missing}")
