import json
import os
import urllib.request

import pytest


API_BASE = os.getenv("PERMISSIONS_TEST_API_BASE", "http://localhost:8001")
OWNER_A = os.getenv("PERMISSIONS_TEST_USER_A", "user-a")
OWNER_B = os.getenv("PERMISSIONS_TEST_USER_B", "user-b")


def _request_json(path: str, owner_id: str):
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        headers={"X-NextHello-User": owner_id},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else []


def _api_available() -> bool:
    try:
        with urllib.request.urlopen(f"{API_BASE}/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def test_cross_tenant_messages_are_not_visible_between_two_real_accounts():
    if not _api_available():
        pytest.skip(f"API is not available at {API_BASE}")

    messages_a = _request_json("/admin/api/messages?limit=500", OWNER_A)
    messages_b = _request_json("/admin/api/messages?limit=500", OWNER_B)

    if not messages_a:
        pytest.skip(
            f"No messages returned for {OWNER_A}. Set PERMISSIONS_TEST_USER_A to a real account owner id."
        )
    if not messages_b:
        pytest.skip(
            f"No messages returned for {OWNER_B}. Set PERMISSIONS_TEST_USER_B to a real account owner id."
        )

    phones_a = {m.get("phoneNumber") for m in messages_a if m.get("phoneNumber")}
    phones_b = {m.get("phoneNumber") for m in messages_b if m.get("phoneNumber")}

    unique_a = next(iter(phones_a - phones_b), None)
    unique_b = next(iter(phones_b - phones_a), None)

    if not (unique_a or unique_b):
        pytest.skip(
            f"Could not find a unique phone between {OWNER_A} and {OWNER_B}; cannot validate isolation"
        )

    if unique_a:
        owner_a_filtered = _request_json(
            f"/admin/api/messages?limit=100&phone={unique_a}",
            OWNER_A,
        )
        owner_b_filtered = _request_json(
            f"/admin/api/messages?limit=100&phone={unique_a}",
            OWNER_B,
        )
        assert owner_a_filtered, f"Expected {OWNER_A} to have messages for phone {unique_a}"
        assert owner_b_filtered == [], f"{OWNER_B} can see {OWNER_A} phone {unique_a}"

    if unique_b:
        owner_b_filtered = _request_json(
            f"/admin/api/messages?limit=100&phone={unique_b}",
            OWNER_B,
        )
        owner_a_filtered = _request_json(
            f"/admin/api/messages?limit=100&phone={unique_b}",
            OWNER_A,
        )
        assert owner_b_filtered, f"Expected {OWNER_B} to have messages for phone {unique_b}"
        assert owner_a_filtered == [], f"{OWNER_A} can see {OWNER_B} phone {unique_b}"
