from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./catisle.db"
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_EXPIRE_MINUTES: int = 10080          # 7 天
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "change-me"
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_MB: int = 5
    RESERVATION_TIMEOUT_MINUTES: int = 120   # 押金支付超时
    DEPOSIT_AMOUNT: int = 2000               # 押金（分）

settings = Settings()
