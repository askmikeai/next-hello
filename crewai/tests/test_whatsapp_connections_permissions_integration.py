import json
import os
import urllib.request

import pytest


API_BASE = os.getenv("PERMISSIONS_TEST_API_BASE", "http://localhost:8001")
OWNER_A = os.getenv("PERMISSIONS_TEST_USER_A", "askmikeai@gmail.com")
OWNER_B = os.getenv("PERMISSIONS_TEST_USER_B", "hollywoodfl23@gmail.com")


def _api_available() -> bool:
    try:
        with urllib.request.urlopen(f"{API_BASE}/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def _get_connector(owner_id: str) -> dict:
    req = urllib.request.Request(
        f"{API_BASE}/admin/api/whatsapp/connector",
        headers={"X-NextHello-User": owner_id},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=8) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def test_whatsapp_connections_are_owner_scoped():
    if not _api_available():
        pytest.skip(f"API is not available at {API_BASE}")

    connector_a = _get_connector(OWNER_A)
    connector_b = _get_connector(OWNER_B)

    assert connector_a.get("available") is True
    assert connector_b.get("available") is True

    assert connector_a.get("sessionId") is not None, f"Expected session visible for {OWNER_A}"
    assert connector_a.get("hasRemoteSession") in (True, False)

    assert connector_b.get("sessionId") in (None, ""), (
        f"{OWNER_B} should not see {OWNER_A} whatsapp session connection"
    )
    assert connector_b.get("connected") is False
    # Non-owners must not see someone else's session identity, but can be offered QR when available.
    assert connector_b.get("hasRemoteSession") in (False, True)
    assert connector_b.get("qrAvailable") in (False, True)
    if connector_b.get("qrAvailable"):
        assert connector_b.get("qrText")
