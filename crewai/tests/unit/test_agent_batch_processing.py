"""
Unit tests for agent batch processing.

Tests the handle_event_batch functionality for parallel event processing.
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from tests.helpers.fakes import FakeEventBus, FakeBlackboard
from tests.helpers.agent_harness import event_factory
from src.swarm.agent_runner import AutonomousAgent
from src.swarm.events import EventType, SwarmEvent
from src.swarm.blackboard import ContactState


class MockAgent(AutonomousAgent):
    """Test agent implementation for batch processing tests."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.executed_events: list[SwarmEvent] = []
        self.fail_on_contact_ids: set[str] = set()

    @property
    def name(self) -> str:
        return "mock-agent"

    @property
    def subscribed_events(self) -> list[EventType]:
        return [EventType.MESSAGE_RECEIVED]

    @property
    def requires_lock(self) -> bool:
        return False

    async def should_act(self, event: SwarmEvent, contact: ContactState) -> bool:
        return True

    async def execute(self, event: SwarmEvent, contact: ContactState) -> list[SwarmEvent]:
        if event.contact_id in self.fail_on_contact_ids:
            raise ValueError(f"Simulated failure for {event.contact_id}")
        self.executed_events.append(event)
        return []


class TestHandleEventBatch:
    """Tests for AutonomousAgent.handle_event_batch()."""

    def setup_method(self):
        """Set up test fixtures."""
        self.eventbus = FakeEventBus()
        self.blackboard = FakeBlackboard()
        self.agent = MockAgent(self.eventbus, self.blackboard)

    @pytest.mark.asyncio
    async def test_batch_empty_list(self):
        """Should return empty list for empty input."""
        results = await self.agent.handle_event_batch([])
        assert results == []

    @pytest.mark.asyncio
    async def test_batch_single_event_success(self):
        """Should process single event successfully."""
        event = event_factory(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id="1111111111",
        )

        results = await self.agent.handle_event_batch([event])

        assert len(results) == 1
        assert results[0] is True
        assert len(self.agent.executed_events) == 1

    @pytest.mark.asyncio
    async def test_batch_multiple_events_all_success(self):
        """Should process multiple events in parallel."""
        events = [
            event_factory(EventType.MESSAGE_RECEIVED, contact_id=f"111111111{i}")
            for i in range(5)
        ]

        results = await self.agent.handle_event_batch(events)

        assert len(results) == 5
        assert all(r is True for r in results)
        assert len(self.agent.executed_events) == 5

    @pytest.mark.asyncio
    async def test_batch_with_some_failures(self):
        """Should handle partial failures gracefully."""
        self.agent.fail_on_contact_ids = {"1111111112", "1111111114"}

        events = [
            event_factory(EventType.MESSAGE_RECEIVED, contact_id=f"111111111{i}")
            for i in range(5)
        ]

        results = await self.agent.handle_event_batch(events)

        assert len(results) == 5
        # Events 0, 1, 3 should succeed (contact_ids 0, 1, 3)
        # Events 2, 4 should fail (contact_ids 2, 4)
        assert results[0] is True
        assert results[1] is True
        assert results[2] is False  # Fails
        assert results[3] is True
        assert results[4] is False  # Fails

    @pytest.mark.asyncio
    async def test_batch_processes_in_parallel(self):
        """Should process events concurrently, not sequentially."""
        # Track timing to verify parallelism
        call_times = []

        original_execute = self.agent.execute

        async def slow_execute(event, contact):
            call_times.append(asyncio.get_event_loop().time())
            await asyncio.sleep(0.1)  # Simulate some work
            return await original_execute(event, contact)

        self.agent.execute = slow_execute

        events = [
            event_factory(EventType.MESSAGE_RECEIVED, contact_id=f"111111111{i}")
            for i in range(3)
        ]

        start = asyncio.get_event_loop().time()
        await self.agent.handle_event_batch(events)
        elapsed = asyncio.get_event_loop().time() - start

        # If parallel, should complete in ~0.1s
        # If sequential, would take ~0.3s
        assert elapsed < 0.25, f"Expected parallel execution, but took {elapsed:.2f}s"
