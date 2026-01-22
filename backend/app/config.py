from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///data/fusion_cache.db"
    ensembl_api_url: str = "https://rest.ensembl.org"
    ensembl_rate_limit: int = 15  # requests per second

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
