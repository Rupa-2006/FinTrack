"""Only correctly signed, fresh, unreplayed requests are accepted."""
import json

import pytest

from app.config import ConfigError, load_settings
from tests.conftest import NOW, payload, signed_headers

PATH = "/v1/insights"


def body_of(data=None) -> bytes:
    return json.dumps(data or payload()).encode()


def test_health_needs_no_signature(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["service"] == "fintrack-ai"


def test_a_signed_request_is_accepted(client):
    body = body_of()
    assert client.post(PATH, content=body, headers=signed_headers(PATH, body)).status_code == 200


@pytest.mark.parametrize("change", [
    "no headers", "wrong secret", "too old", "from the future", "body changed", "other path", "other method", "bad id", "bad signature format",
])
def test_anything_else_is_refused(client, change):
    body = body_of()
    headers = signed_headers(PATH, body)
    sent_body, path = body, PATH
    if change == "no headers":
        headers = {"content-type": "application/json"}
    elif change == "wrong secret":
        headers = signed_headers(PATH, body, secret=bytes.fromhex("cd" * 32))
    elif change == "too old":
        headers = signed_headers(PATH, body, timestamp=NOW - 61)
    elif change == "from the future":
        headers = signed_headers(PATH, body, timestamp=NOW + 61)
    elif change == "body changed":
        sent_body = body.replace(b'"INR"', b'"USD"')
    elif change == "other path":
        path = "/v1/assistant/ask"
    elif change == "other method":
        headers = signed_headers(PATH, body, method="PUT")
    elif change == "bad id":
        headers["x-fintrack-request-id"] = "x"
    elif change == "bad signature format":
        headers["x-fintrack-signature"] = "zz" * 32
    res = client.post(path, content=sent_body, headers=headers)
    assert res.status_code == 401
    assert res.json() == {"success": False, "error": {"code": "UNAUTHENTICATED", "message": "The request could not be authenticated"}}


def test_a_replayed_request_is_refused(client):
    body = body_of()
    headers = signed_headers(PATH, body, request_id="replay-test-0001")
    assert client.post(PATH, content=body, headers=headers).status_code == 200
    assert client.post(PATH, content=body, headers=headers).status_code == 401


def test_an_unsigned_request_is_refused_before_its_body_is_validated(client):
    res = client.post(PATH, content=b'{"not": "valid"}', headers={"content-type": "application/json"})
    assert res.status_code == 401  # not 422: nothing about the schema leaks to an unauthenticated caller


def test_invalid_fields_are_named_but_their_values_are_not_echoed(post_signed):
    res = post_signed(PATH, payload(currency="DOGE", transactions=[{"id": 1, "date": "2026-11-01", "type": "EXPENSE", "amount": "-5", "category": "secret-value"}]))
    assert res.status_code == 422
    text = res.text
    assert "VALIDATION_ERROR" in text and "currency" in text
    assert "DOGE" not in text and "secret-value" not in text


def test_unknown_fields_are_rejected(post_signed):
    assert post_signed(PATH, payload(userId=7)).status_code == 422
    assert post_signed(PATH, payload(transactions=[{**payload()["transactions"][0], "notes": "private"}])).status_code == 422


def test_the_service_will_not_start_without_a_proper_secret():
    for bad in ["", "replace_with_64_hex_chars", "ab" * 31, "zz" * 32]:
        with pytest.raises(ConfigError):
            load_settings({"AI_SERVICE_SHARED_SECRET": bad})
    with pytest.raises(ConfigError):
        load_settings({"AI_SERVICE_SHARED_SECRET": "ab" * 32, "SIGNATURE_MAX_AGE_SECONDS": "100000"})


def test_interactive_docs_are_off(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
