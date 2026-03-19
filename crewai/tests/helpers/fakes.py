"""
Fake implementations for testing swarm agents in isolation.

These fakes provide in-memory implementations of Redis, PostgreSQL,
EventBus, and Blackboard for unit testing without external dependencies.
"""

import json
import asyncio
from typing import Optional, Dict, List, Any, Callable, Awaitable
from dataclasses import dataclass, field
from datetime import datetime

# Import types from swarm
import sys
import types

# Stub asyncpg if not present
if "asyncpg" not in sys.modules:
    asyncpg_stub = types.ModuleType("asyncpg")

    async def _create_pool_stub(*_args, **_kwargs):
        raise RuntimeError("asyncpg is stubbed in unit tests")

    asyncpg_stub.create_pool = _create_pool_stub
    asyncpg_stub.Pool = object
    sys.modules["asyncpg"] = asyncpg_stub


class FakeRedis:
    """In-memory Redis mock for unit testing."""

    def __init__(self):
        self.store: Dict[str, str] = {}
        self.expiry: Dict[str, float] = {}

    async def get(self, key: str) -> Optional[str]:
        """Get a value from the store."""
        return self.store.get(key)

    async def set(
        self,
        key: str,
        value: str,
        nx: bool = False,
        ex: Optional[int] = None,
    ) -> bool:
        """Set a value in the store with optional NX (not exists) and EX (expiry)."""
        if nx and key in self.store:
            return False
        self.store[key] = value
        if ex:
            self.expiry[key] = datetime.utcnow().timestamp() + ex
        return True

    async def setex(self, key: str, ttl: int, value: str) -> bool:
        """Set a value with expiry."""
        self.store[key] = value
        self.expiry[key] = datetime.utcnow().timestamp() + ttl
        return True

    async def delete(self, key: str) -> int:
        """Delete a key from the store."""
        if key in self.store:
            del self.store[key]
            self.expiry.pop(key, None)
            return 1
        return 0

    async def xadd(
        self,
        stream: str,
        fields: Dict[str, str],
        id: str = "*",
        maxlen: Optional[int] = None,
    ) -> str:
        """Add to a stream (simplified implementation)."""
        if stream not in self.store:
            self.store[stream] = "[]"
        entries = json.loads(self.store[stream])
        entry_id = f"{int(datetime.utcnow().timestamp() * 1000)}-{len(entries)}"
        entries.append({"id": entry_id, "fields": fields})
        if maxlen and len(entries) > maxlen:
            entries = entries[-maxlen:]
        self.store[stream] = json.dumps(entries)
        return entry_id

    async def xread(
        self,
        streams: Dict[str, str],
        count: Optional[int] = None,
        block: Optional[int] = None,
    ) -> List:
        """Read from streams (simplified implementation)."""
        results = []
        for stream_name, last_id in streams.items():
            if stream_name in self.store:
                entries = json.loads(self.store[stream_name])
                results.append((stream_name, entries))
        return results

    async def aclose(self) -> None:
        """Close the connection (no-op for fake)."""
        pass


class FakeConn:
    """Fake database connection for unit testing."""

    def __init__(self, rows: Optional[List[Dict[str, Any]]] = None):
        self._rows = rows or []
        self._executed: List[tuple] = []

    async def fetch(self, query: str, *args) -> List[Dict[str, Any]]:
        """Execute a query and return rows."""
        self._executed.append((query, args))
        # Simple filter by owner_id if provided
        if args and "owner_id" in query.lower():
            owner_id = args[0]
            return [row for row in self._rows if row.get("owner_id") == owner_id]
        return self._rows

    async def fetchrow(self, query: str, *args) -> Optional[Dict[str, Any]]:
        """Fetch a single row."""
        self._executed.append((query, args))
        if args and len(args) >= 2:
            owner_id = args[0]
            contact_id = args[1]
            for row in self._rows:
                if row.get("owner_id") == owner_id and row.get("phone_number") == contact_id:
                    return row
        elif self._rows:
            return self._rows[0]
        return None

    async def execute(self, query: str, *args) -> str:
        """Execute a query without returning rows."""
        self._executed.append((query, args))
        return "INSERT 1"


class _FakeAcquire:
    """Context manager for FakePool.acquire()."""

    def __init__(self, conn: FakeConn):
        self._conn = conn

    async def __aenter__(self) -> FakeConn:
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakePool:
    """Fake connection pool for unit testing."""

    def __init__(self, rows: Optional[List[Dict[str, Any]]] = None):
        self._conn = FakeConn(rows)
        self._rows = rows or []

    def acquire(self) -> _FakeAcquire:
        """Acquire a connection from the pool."""
        return _FakeAcquire(self._conn)

    async def close(self) -> None:
        """Close the pool (no-op for fake)."""
        pass

    def add_row(self, row: Dict[str, Any]) -> None:
        """Add a row to the fake database."""
        self._rows.append(row)
        self._conn._rows = self._rows


@dataclass
class CapturedEvent:
    """Event captured by FakeEventBus."""

    event: Any  # SwarmEvent
    timestamp: datetime = field(default_factory=datetime.utcnow)


class FakeEventBus:
    """In-memory EventBus mock for unit testing."""

    def __init__(self):
        self.published_events: List[CapturedEvent] = []
        self._handlers: Dict[str, Callable] = {}
        self._connected = False

    async def connect(self) -> None:
        """Connect to the event bus."""
        self._connected = True

    async def close(self) -> None:
        """Close the event bus."""
        self._connected = False

    async def publish(self, event: Any) -> str:
        """Publish an event and capture it."""
        self.published_events.append(CapturedEvent(event=event))
        return event.event_id

    async def publish_batch(self, events: List[Any]) -> List[str]:
        """Publish multiple events."""
        ids = []
        for event in events:
            ids.append(await self.publish(event))
        return ids

    def start_consumer(
        self,
        streams: List[str],
        consumer_group: str,
        consumer_name: str,
        handler: Callable,
        event_types: Optional[List] = None,
    ) -> asyncio.Task:
        """Start a consumer (returns a no-op task for testing)."""
        self._handlers[consumer_name] = handler

        async def _noop():
            pass

        return asyncio.create_task(_noop())

    async def subscribe(
        self,
        streams: List[str],
        consumer_group: str,
        consumer_name: str,
        handler: Callable,
        event_types: Optional[List] = None,
    ) -> None:
        """Subscribe to streams."""
        self._handlers[consumer_name] = handler

    def get_published_by_type(self, event_type: Any) -> List[Any]:
        """Get all published events of a specific type."""
        result = []
        for captured in self.published_events:
            evt = captured.event
            if hasattr(evt, "event_type"):
                if evt.event_type == event_type or (
                    hasattr(evt.event_type, "value")
                    and hasattr(event_type, "value")
                    and evt.event_type.value == event_type.value
                ):
                    result.append(evt)
        return result

    def clear(self) -> None:
        """Clear all captured events."""
        self.published_events.clear()


class FakeBlackboard:
    """In-memory Blackboard mock for unit testing."""

    def __init__(
        self,
        redis: Optional[FakeRedis] = None,
        pool: Optional[FakePool] = None,
    ):
        self._redis = redis or FakeRedis()
        self._pool = pool or FakePool()
        self._contacts: Dict[str, Dict[str, Any]] = {}
        self._agent_states: Dict[str, Dict[str, str]] = {}
        self._locks: Dict[str, str] = {}
        self._activity_log: List[Dict[str, Any]] = []
        self._event_log: List[Any] = []
        self._owner_context = "test-owner"

    async def connect(self) -> None:
        """Connect to backends (no-op for fake)."""
        pass

    async def close(self) -> None:
        """Close connections (no-op for fake)."""
        pass

    def set_owner_context(self, owner_id: str) -> str:
        """Set the owner context and return a token."""
        old = self._owner_context
        self._owner_context = owner_id or "test-owner"
        return old

    def reset_owner_context(self, token: str) -> None:
        """Reset the owner context using the token."""
        self._owner_context = token

    def _normalize_owner_id(self, owner_id: Optional[str]) -> str:
        """Normalize owner ID."""
        return (owner_id or self._owner_context or "test-owner").strip().lower()

    def _contact_key(self, owner_id: str, contact_id: str) -> str:
        """Get the key for a contact."""
        return f"{owner_id}:{contact_id}"

    async def get_contact(
        self,
        contact_id: str,
        owner_id: Optional[str] = None,
    ) -> Optional[Any]:
        """Get contact state."""
        # Import here to avoid circular imports
        from src.swarm.blackboard import ContactState

        owner = self._normalize_owner_id(owner_id)
        key = self._contact_key(owner, contact_id)
        data = self._contacts.get(key)
        if data:
            return ContactState.from_dict(data)
        return None

    async def save_contact(self, state: Any, owner_id: Optional[str] = None) -> None:
        """Save contact state."""
        owner = self._normalize_owner_id(owner_id)
        key = self._contact_key(owner, state.phone_number)
        self._contacts[key] = state.to_dict()

    async def update_contact(
        self,
        contact_id: str,
        owner_id: Optional[str] = None,
        **updates: Any,
    ) -> Any:
        """Update contact state."""
        from src.swarm.blackboard import ContactState

        owner = self._normalize_owner_id(owner_id)
        key = self._contact_key(owner, contact_id)

        if key in self._contacts:
            data = self._contacts[key]
        else:
            data = {"phone_number": contact_id}

        data.update(updates)
        self._contacts[key] = data
        return ContactState.from_dict(data)

    async def acquire_lock(
        self,
        contact_id: str,
        owner: str,
        owner_id: Optional[str] = None,
        ttl: int = 30,
    ) -> bool:
        """Acquire a lock for a contact."""
        tenant = self._normalize_owner_id(owner_id)
        key = f"{tenant}:{contact_id}"
        if key in self._locks:
            return False
        self._locks[key] = owner
        return True

    async def release_lock(
        self,
        contact_id: str,
        owner: str,
        owner_id: Optional[str] = None,
    ) -> bool:
        """Release a lock for a contact."""
        tenant = self._normalize_owner_id(owner_id)
        key = f"{tenant}:{contact_id}"
        if key in self._locks and self._locks[key] == owner:
            del self._locks[key]
            return True
        return False

    async def log_event(self, event: Any, owner_id: Optional[str] = None) -> None:
        """Log an event."""
        self._event_log.append(event)

    async def log_agent_activity_start(
        self,
        agent_type: str,
        action: str,
        correlation_id: str,
        started_at: datetime,
        owner_id: Optional[str] = None,
    ) -> Optional[str]:
        """Log agent activity start."""
        import uuid

        activity_id = str(uuid.uuid4())
        self._activity_log.append(
            {
                "id": activity_id,
                "agent_type": agent_type,
                "action": action,
                "correlation_id": correlation_id,
                "started_at": started_at,
                "owner_id": self._normalize_owner_id(owner_id),
                "status": "started",
            }
        )
        return activity_id

    async def log_agent_activity_complete(
        self,
        activity_id: Optional[str],
        status: str,
        completed_at: datetime,
        duration_ms: int,
        error_message: Optional[str] = None,
    ) -> None:
        """Log agent activity completion."""
        for activity in self._activity_log:
            if activity.get("id") == activity_id:
                activity["status"] = status
                activity["completed_at"] = completed_at
                activity["duration_ms"] = duration_ms
                activity["error_message"] = error_message
                break

    async def get_agent_state(
        self,
        agent_name: str,
        contact_id: str,
        owner_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get agent-specific state."""
        owner = self._normalize_owner_id(owner_id)
        key = f"{owner}:{agent_name}:{contact_id}"
        state = self._agent_states.get(key)
        if state:
            return {"state": state, "agent_name": agent_name, "contact_id": contact_id}
        return None

    async def save_agent_state(
        self,
        agent_name: str,
        contact_id: str,
        state: str,
        event_id: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> None:
        """Save agent-specific state."""
        owner = self._normalize_owner_id(owner_id)
        key = f"{owner}:{agent_name}:{contact_id}"
        self._agent_states[key] = state

    def set_contact(self, contact: Any, owner_id: Optional[str] = None) -> None:
        """Helper to pre-populate contact state for tests."""
        owner = self._normalize_owner_id(owner_id)
        key = self._contact_key(owner, contact.phone_number)
        self._contacts[key] = contact.to_dict()

    @property
    def contacts(self) -> "_ContactsDict":
        """
        Direct access to contacts dict for tests.

        Allows both dict-style access and ContactState storage:
            blackboard.contacts["owner:phone"] = ContactState(...)
            contact = blackboard.contacts.get("owner:phone")
        """
        return _ContactsDict(self)

    async def delete_contact_data(
        self, contact_id: str, owner_id: Optional[str] = None
    ) -> Dict[str, int]:
        """Delete all stored data for a contact."""
        owner = self._normalize_owner_id(owner_id)
        key = self._contact_key(owner, contact_id)
        deleted = {
            "contacts": 1 if key in self._contacts else 0,
            "messages": 0,
            "events": 0,
            "agent_states": 0,
            "activities": 0,
        }
        if key in self._contacts:
            del self._contacts[key]
        return deleted


class _ContactsDict:
    """
    Helper class that wraps FakeBlackboard._contacts for dict-like access.

    Allows tests to do:
        blackboard.contacts["owner:phone"] = ContactState(...)
        contact = blackboard.contacts.get("owner:phone")
    """

    def __init__(self, blackboard: FakeBlackboard):
        self._blackboard = blackboard

    def __setitem__(self, key: str, value: Any) -> None:
        """Set a contact state by key."""
        # Value can be ContactState or dict
        if hasattr(value, "to_dict"):
            self._blackboard._contacts[key] = value.to_dict()
        else:
            self._blackboard._contacts[key] = value

    def __getitem__(self, key: str) -> Optional[Any]:
        """Get a contact state by key."""
        from src.swarm.blackboard import ContactState

        data = self._blackboard._contacts.get(key)
        if data:
            return ContactState.from_dict(data)
        return None

    def get(self, key: str, default: Any = None) -> Optional[Any]:
        """Get a contact state by key with default."""
        from src.swarm.blackboard import ContactState

        data = self._blackboard._contacts.get(key)
        if data:
            return ContactState.from_dict(data)
        return default

    def __contains__(self, key: str) -> bool:
        """Check if a key exists."""
        return key in self._blackboard._contacts
