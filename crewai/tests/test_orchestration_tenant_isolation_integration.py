import json
import os
import subprocess
import time
import urllib.request
import uuid

import pytest


API_BASE = os.getenv("PERMISSIONS_TEST_API_BASE", "http://localhost:8001")
OWNER_A = os.getenv("PERMISSIONS_TEST_USER_A", "askmikeai@gmail.com")
OWNER_B = os.getenv("PERMISSIONS_TEST_USER_B", "hollywoodfl23@gmail.com")
POSTGRES_CONTAINER = os.getenv("NEXTHELLO_POSTGRES_CONTAINER", "nexthello-postgres")
POSTGRES_DB = os.getenv("POSTGRES_DB", "nexthello")
POSTGRES_USER = os.getenv("POSTGRES_USER", "nexthello")
REDIS_CONTAINER = os.getenv("NEXTHELLO_REDIS_CONTAINER", "nexthello-redis")


def _sanitize_owner(value: str) -> str:
    candidate = (value or "").strip().lower()
    out = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in candidate)
    return out[:80] or "askmikeai-gmail.com"


def _api_available() -> bool:
    try:
        with urllib.request.urlopen(f"{API_BASE}/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def _request_json(method: str, path: str, owner: str, payload: dict | None = None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=body,
        headers={"Content-Type": "application/json", "X-NextHello-User": owner},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def _sql_scalar(sql: str) -> int:
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            POSTGRES_CONTAINER,
            "psql",
            "-U",
            POSTGRES_USER,
            "-d",
            POSTGRES_DB,
            "-At",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr.strip() or result.stdout.strip())
    value = (result.stdout or "0").strip().splitlines()
    return int(value[0] if value and value[0] else "0")


def _redis_stream_dump(stream: str, count: int = 300) -> str:
    result = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            REDIS_CONTAINER,
            "redis-cli",
            "--raw",
            "XREVRANGE",
            stream,
            "+",
            "-",
            "COUNT",
            str(count),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(result.stderr.strip() or result.stdout.strip())
    return result.stdout or ""


def _redis_event_json_rows(stream: str, count: int = 300) -> list[dict]:
    raw = _redis_stream_dump(stream, count=count)
    rows: list[dict] = []
    for line in raw.splitlines():
        text = line.strip()
        if not text.startswith("{"):
            continue
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                rows.append(parsed)
        except Exception:
            continue
    return rows


def test_orchestration_and_shared_recipient_are_tenant_isolated():
    if not _api_available():
        pytest.skip(f"API is not available at {API_BASE}")

    run_id = uuid.uuid4().hex[:8]
    shared_phone = f"1555{uuid.uuid4().hex[:7]}"
    msg_a = f"owner-a-instruction-{run_id}"
    msg_b = f"owner-b-instruction-{run_id}"
    message_id_a = f"a-{run_id}"
    message_id_b = f"b-{run_id}"
    owner_a_db = _sanitize_owner(OWNER_A)
    owner_b_db = _sanitize_owner(OWNER_B)

    try:
        _request_json(
            "POST",
            "/whatsapp/message",
            OWNER_A,
            {
                "phone_number": shared_phone,
                "message_id": message_id_a,
                "message_type": "text",
                "content": msg_a,
                "push_name": "Owner A",
            },
        )
        _request_json(
            "POST",
            "/whatsapp/message",
            OWNER_B,
            {
                "phone_number": shared_phone,
                "message_id": message_id_b,
                "message_type": "text",
                "content": msg_b,
                "push_name": "Owner B",
            },
        )

        msgs_a = _request_json(
            "GET",
            f"/admin/api/contacts/{shared_phone}/messages?limit=50&safe=false",
            OWNER_A,
        )
        msgs_b = _request_json(
            "GET",
            f"/admin/api/contacts/{shared_phone}/messages?limit=50&safe=false",
            OWNER_B,
        )

        contents_a = {m.get("content") for m in (msgs_a or [])}
        contents_b = {m.get("content") for m in (msgs_b or [])}

        assert msg_a in contents_a
        assert msg_b in contents_b
        assert msg_b not in contents_a
        assert msg_a not in contents_b

        _request_json("POST", f"/admin/api/swarm/trigger/research/{shared_phone}", OWNER_A)

        found_a = False
        found_b = False
        deadline = time.time() + 12
        while time.time() < deadline:
            events = _redis_event_json_rows("swarm:events:research", count=500)
            found_a = any(
                e.get("event_type") == "research.needed"
                and e.get("contact_id") == shared_phone
                and e.get("owner_id") == owner_a_db
                for e in events
            )
            found_b = any(
                e.get("event_type") == "research.needed"
                and e.get("contact_id") == shared_phone
                and e.get("owner_id") == owner_b_db
                for e in events
            )
            if found_a:
                break
            time.sleep(0.5)

        assert found_a, "Owner A orchestration event was not published"
        assert not found_b, "Owner B received Owner A orchestration event for shared recipient"
    finally:
        for owner in (OWNER_A, OWNER_B):
            try:
                _request_json(
                    "POST",
                    "/admin/api/contacts/delete",
                    owner,
                    {"phone_number": shared_phone},
                )
            except Exception:
                pass
