"""Verification of signed requests from the FinTrack API.

Every request except the health check must carry:

    X-FinTrack-Timestamp   Unix time in seconds when the API signed it
    X-FinTrack-Request-Id  a value used once (UUID)
    X-FinTrack-Signature   hex HMAC-SHA256(shared secret, string_to_sign)

    string_to_sign = timestamp + "\\n" + METHOD + "\\n" + path + "\\n" + request id + "\\n" + sha256_hex(body)

So a request is accepted only if it was signed by a holder of the secret, recently, for this
exact method, path and body, and has not been seen before (replay protection).
Must stay in step with backend/services/aiClient.js.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time

from fastapi import HTTPException, Request

UNAUTHORIZED = "The request could not be authenticated"
_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def string_to_sign(timestamp: str, method: str, path: str, request_id: str, body: bytes) -> bytes:
    body_hash = hashlib.sha256(body).hexdigest()
    return f"{timestamp}\n{method.upper()}\n{path}\n{request_id}\n{body_hash}".encode()


def sign(secret: bytes, timestamp: str, method: str, path: str, request_id: str, body: bytes) -> str:
    return hmac.new(secret, string_to_sign(timestamp, method, path, request_id, body), hashlib.sha256).hexdigest()


class ReplayGuard:
    """Remembers request ids for as long as their signatures stay valid."""

    def __init__(self, ttl_seconds: int, max_entries: int = 100_000):
        self._ttl = ttl_seconds
        self._max = max_entries
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def first_use(self, request_id: str, now: float) -> bool:
        with self._lock:
            if len(self._seen) > self._max or len(self._seen) % 1000 == 0:
                self._seen = {key: expiry for key, expiry in self._seen.items() if expiry > now}
            expiry = self._seen.get(request_id)
            if expiry is not None and expiry > now:
                return False
            self._seen[request_id] = now + 2 * self._ttl
            return True


class SignatureVerifier:
    def __init__(self, secret: bytes, max_age_seconds: int, clock=time.time):
        self._secret = secret
        self._max_age = max_age_seconds
        self._clock = clock
        self._replays = ReplayGuard(max_age_seconds)

    async def __call__(self, request: Request) -> None:
        timestamp = request.headers.get("x-fintrack-timestamp", "")
        request_id = request.headers.get("x-fintrack-request-id", "")
        signature = request.headers.get("x-fintrack-signature", "")
        if not timestamp.isdigit() or not _REQUEST_ID.match(request_id) or not re.fullmatch(r"[0-9a-f]{64}", signature):
            raise HTTPException(status_code=401, detail=UNAUTHORIZED)

        now = self._clock()
        if abs(now - int(timestamp)) > self._max_age:
            raise HTTPException(status_code=401, detail=UNAUTHORIZED)

        body = await request.body()
        expected = sign(self._secret, timestamp, request.method, request.url.path, request_id, body)
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(status_code=401, detail=UNAUTHORIZED)

        # Checked last, so an attacker cannot burn ids without a valid signature.
        if not self._replays.first_use(request_id, now):
            raise HTTPException(status_code=401, detail=UNAUTHORIZED)
