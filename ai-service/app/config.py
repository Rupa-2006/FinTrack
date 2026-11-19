"""Configuration, read once from the environment (and ai-service/.env in development).

The service refuses to start without a proper shared secret, so it can never run in a mode
that accepts unsigned requests.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    shared_secret: bytes
    max_age_seconds: int
    docs_enabled: bool


def load_settings(env: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ if env is None else env)
    secret = env.get("AI_SERVICE_SHARED_SECRET", "")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", secret):
        raise ConfigError("AI_SERVICE_SHARED_SECRET must be 64 hexadecimal characters (the same value as in backend/.env)")
    try:
        max_age = int(env.get("SIGNATURE_MAX_AGE_SECONDS", "60"))
    except ValueError as err:
        raise ConfigError("SIGNATURE_MAX_AGE_SECONDS must be a whole number") from err
    if not 5 <= max_age <= 600:
        raise ConfigError("SIGNATURE_MAX_AGE_SECONDS must be between 5 and 600")
    return Settings(
        shared_secret=bytes.fromhex(secret),
        max_age_seconds=max_age,
        # The service is internal; its interactive docs are off unless asked for.
        docs_enabled=env.get("AI_DOCS_ENABLED", "false").lower() == "true",
    )
