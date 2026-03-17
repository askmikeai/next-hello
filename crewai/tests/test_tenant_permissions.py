import sys
import types
import asyncio
import inspect
from pathlib import Path


if "asyncpg" not in sys.modules:
    asyncpg_stub = types.ModuleType("asyncpg")

    async def _create_pool_stub(*_args, **_kwargs):
        raise RuntimeError("asyncpg is stubbed in unit tests")

    asyncpg_stub.create_pool = _create_pool_stub
    asyncpg_stub.Pool = object
    sys.modules["asyncpg"] = asyncpg_stub

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

for module_name in list(sys.modules.keys()):
    if module_name == "src" or module_name.startswith("src."):
        del sys.modules[module_name]

from src.swarm.blackboard import Blackboard


class _FakeRedis:
    def __init__(self):
        self.store = {}

    async def get(self, key):
        return self.store.get(key)

    async def setex(self, key, _ttl, value):
        self.store[key] = value


class _Acquire:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, _query, owner_id, limit, offset):
        filtered = [row for row in self._rows if row["owner_id"] == owner_id]
        return filtered[offset : offset + limit]

    async def fetchrow(self, _query, owner_id, contact_id):
        for row in self._rows:
            if row["owner_id"] == owner_id and row["phone_number"] == contact_id:
                return row
        return None


class _FakePool:
    def __init__(self, rows):
        self._conn = _FakeConn(rows)

    def acquire(self):
        return _Acquire(self._conn)


def _build_blackboard(rows):
    board = Blackboard(redis_url="redis://unused", database_url="postgres://unused")
    board._redis = _FakeRedis()
    board._pool = _FakePool(rows)
    return board


def _call_list_contacts(board, owner_id):
    sig = inspect.signature(board.list_contacts)
    if "owner_id" in sig.parameters:
        return asyncio.run(board.list_contacts(owner_id=owner_id))

    token = board.set_owner_context(owner_id)
    try:
        return asyncio.run(board.list_contacts())
    finally:
        board.reset_owner_context(token)


def _call_get_contact(board, phone_number, owner_id):
    sig = inspect.signature(board.get_contact)
    if "owner_id" in sig.parameters:
        return asyncio.run(board.get_contact(phone_number, owner_id=owner_id))

    token = board.set_owner_context(owner_id)
    try:
        return asyncio.run(board.get_contact(phone_number))
    finally:
        board.reset_owner_context(token)


def test_list_contacts_isolated_by_owner():
    board = _build_blackboard(
        [
            {"owner_id": "user-a", "phone_number": "1111111111", "first_name": "Alice"},
            {"owner_id": "user-b", "phone_number": "2222222222", "first_name": "Bob"},
        ]
    )

    contacts_a = _call_list_contacts(board, "user-a")
    contacts_b = _call_list_contacts(board, "user-b")

    assert [contact.phone_number for contact in contacts_a] == ["1111111111"]
    assert [contact.phone_number for contact in contacts_b] == ["2222222222"]


def test_get_contact_does_not_cross_tenant_boundaries():
    board = _build_blackboard(
        [
            {"owner_id": "user-a", "phone_number": "3333333333", "first_name": "Ana"},
            {"owner_id": "user-b", "phone_number": "3333333333", "first_name": "Ben"},
        ]
    )

    contact_for_a = _call_get_contact(board, "3333333333", "user-a")
    contact_for_b = _call_get_contact(board, "3333333333", "user-b")

    assert contact_for_a is not None
    assert contact_for_b is not None
    assert contact_for_a.first_name == "Ana"
    assert contact_for_b.first_name == "Ben"
    assert contact_for_a.first_name != contact_for_b.first_name
