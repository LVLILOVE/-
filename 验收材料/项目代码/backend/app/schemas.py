from pydantic import BaseModel, Field, field_validator
import re

PHONE_RE = re.compile(r"^1[3-9]\d{9}$")

# ===== 认证 =====
class LoginIn(BaseModel):
    username: str
    password: str

class LoginOut(BaseModel):
    token: str
    expires_in: int

# ===== 预约 =====
class ReservationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    phone: str
    reserve_date: str
    slot: str
    party_size: int = Field(ge=1, le=6)
    has_child: bool = False
    remark: str = ""

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v):
        if not PHONE_RE.match(v):
            raise ValueError("手机号格式不正确")
        return v

class PaymentProofIn(BaseModel):
    phone: str
    trans_no: str = ""
    nickname: str = Field(min_length=1, max_length=50)

class CancelIn(BaseModel):
    phone: str

# ===== 领养 =====
class AdoptionCreate(BaseModel):
    cat_id: int | None = None
    name: str = Field(min_length=1)
    phone: str
    city: str
    housing: str
    experience: str = ""
    family_agreed: str = ""
    reason: str = Field(min_length=5)
    photos: list[str] = []

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v):
        if not PHONE_RE.match(v):
            raise ValueError("手机号格式不正确")
        return v

# ===== 后台 =====
class VerifyPaymentIn(BaseModel):
    result: str                      # pass / reject
    reason: str = ""

class AdminActionIn(BaseModel):
    action: str                      # cancel / arrive / no_show
    reason: str = ""

class AdoptionFlowIn(BaseModel):
    status: str
    note: str = ""
    success_story: str = ""
    success_photo: str = ""

class AdoptionNoteIn(BaseModel):
    note_date: str
    content: str
