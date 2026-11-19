"""FinTrack AI service.

    GET  /health                 liveness (no signature)
    POST /v1/insights            insight cards, unusual expenses, month-end estimate, suggestions
    POST /v1/assistant/ask       answer a question about the records in the request

Stateless: it stores nothing, logs no request bodies and has no database access. Only the
FinTrack API can call it (see security.py); it should not be exposed to the internet.

Run: .venv\\Scripts\\python -m uvicorn --factory app.main:create_app --port 8000
"""
from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Settings, load_settings
from .schemas import AskRequest, FinancialData
from .security import SignatureVerifier
from .services import assistant, insights
from .wire import wire

VERSION = "1.0.0"
log = logging.getLogger("fintrack.ai")


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "error": {"code": code, "message": message}})


def create_app(settings: Settings | None = None, clock=None) -> FastAPI:
    settings = settings or load_settings()
    verify = SignatureVerifier(settings.shared_secret, settings.max_age_seconds, **({"clock": clock} if clock else {}))
    docs = {} if settings.docs_enabled else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="FinTrack AI service", version=VERSION, **docs)

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException):
        code = {401: "UNAUTHENTICATED", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "BAD_REQUEST")
        return error(exc.status_code, code, str(exc.detail) if exc.status_code == 401 else "The request could not be processed")

    # Field locations only; the submitted values are never echoed back.
    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        fields = sorted({".".join(str(part) for part in item["loc"][1:3]) for item in exc.errors()})[:10]
        return error(422, "VALIDATION_ERROR", f"Invalid request fields: {', '.join(fields)}")

    @app.exception_handler(Exception)
    async def unexpected(_request: Request, exc: Exception):
        log.error("unhandled error: %s", type(exc).__name__)
        return error(500, "INTERNAL_ERROR", "The analysis failed")

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "fintrack-ai", "version": VERSION}

    @app.post("/v1/insights", dependencies=[Depends(verify)])
    def post_insights(body: FinancialData):
        return {"success": True, "data": wire(insights.build(body))}

    @app.post("/v1/assistant/ask", dependencies=[Depends(verify)])
    def post_ask(body: AskRequest):
        return {"success": True, "data": wire(assistant.answer(body))}

    return app
