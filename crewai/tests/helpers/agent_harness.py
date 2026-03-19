"""
Agent Test Harness for unit testing swarm agents.

Provides a wrapper around agents with fake backends for isolated testing.
"""

import sys
import types
from typing import Type, List, Optional, Dict, Any
from datetime import datetime

# Stub asyncpg if not present
if "asyncpg" not in sys.modules:
    asyncpg_stub = types.ModuleType("asyncpg")

    async def _create_pool_stub(*_args, **_kwargs):
        raise RuntimeError("asyncpg is stubbed in unit tests")

    asyncpg_stub.create_pool = _create_pool_stub
    asyncpg_stub.Pool = object
    sys.modules["asyncpg"] = asyncpg_stub

from .fakes import FakeEventBus, FakeBlackboard

# Import from swarm after stubbing
from src.swarm.agent_runner import AutonomousAgent
from src.swarm.events import SwarmEvent, EventType
from src.swarm.blackboard import ContactState


class AgentTestHarness:
    """
    Test harness for unit testing swarm agents in isolation.

    Provides:
    - Fake EventBus with captured events
    - Fake Blackboard with in-memory state
    - Helper methods for assertions
    - Factory methods for test data

    Usage:
        harness = AgentTestHarness(ResearchAgent)
        harness.set_contact(ContactState(phone_number="1234567890", email="test@example.com"))
        event = harness.create_event(EventType.CONTACT_CREATED, contact_id="1234567890")
        result = await harness.send_event(event)
        harness.assert_published(EventType.RESEARCH_COMPLETED)
    """

    def __init__(
        self,
        agent_class: Type[AutonomousAgent],
        owner_id: str = "test-owner",
    ):
        self.eventbus = FakeEventBus()
        self.blackboard = FakeBlackboard()
        self.owner_id = owner_id
        self.agent = agent_class(self.eventbus, self.blackboard)
        self.published_events: List[SwarmEvent] = []

    async def send_event(self, event: SwarmEvent) -> bool:
        """
        Send an event to the agent's handle_event method.

        Args:
            event: The event to send

        Returns:
            True if event was processed successfully
        """
        result = await self.agent.handle_event(event)
        # Capture any published events
        self.published_events = [
            captured.event for captured in self.eventbus.published_events
        ]
        return result

    async def should_act(self, event: SwarmEvent, contact: ContactState) -> bool:
        """
        Check if the agent would act on an event.

        Args:
            event: The event to check
            contact: The contact state to check against

        Returns:
            True if agent would process this event
        """
        return await self.agent.should_act(event, contact)

    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute the agent's logic directly.

        Args:
            event: The triggering event
            contact: The contact state

        Returns:
            List of result events
        """
        return await self.agent.execute(event, contact)

    def create_event(
        self,
        event_type: EventType,
        contact_id: str,
        payload: Optional[Dict[str, Any]] = None,
        source_agent: str = "test",
    ) -> SwarmEvent:
        """
        Create a test event.

        Args:
            event_type: Type of event
            contact_id: Contact identifier
            payload: Event payload
            source_agent: Source agent name

        Returns:
            SwarmEvent instance
        """
        return SwarmEvent(
            event_type=event_type,
            contact_id=contact_id,
            owner_id=self.owner_id,
            payload=payload or {},
            source_agent=source_agent,
        )

    def create_contact(
        self,
        phone_number: str,
        **kwargs: Any,
    ) -> ContactState:
        """
        Create a test contact.

        Args:
            phone_number: Contact phone number
            **kwargs: Additional contact fields

        Returns:
            ContactState instance
        """
        return ContactState(phone_number=phone_number, **kwargs)

    def set_contact(
        self,
        contact: ContactState,
        owner_id: Optional[str] = None,
    ) -> None:
        """
        Set a contact in the fake blackboard.

        Args:
            contact: Contact state to set
            owner_id: Optional owner ID (uses harness owner_id if not provided)
        """
        self.blackboard.set_contact(contact, owner_id or self.owner_id)

    def assert_published(
        self,
        event_type: EventType,
        payload_contains: Optional[Dict[str, Any]] = None,
        count: Optional[int] = None,
    ) -> None:
        """
        Assert that an event of the given type was published.

        Args:
            event_type: Expected event type
            payload_contains: Optional dict that should be a subset of payload
            count: Optional exact count of events (default: at least 1)

        Raises:
            AssertionError if assertion fails
        """
        matching = self.eventbus.get_published_by_type(event_type)

        if count is not None:
            assert len(matching) == count, (
                f"Expected {count} {event_type} events, got {len(matching)}"
            )
        else:
            assert len(matching) >= 1, f"Expected at least 1 {event_type} event, got 0"

        if payload_contains:
            found = False
            for event in matching:
                if all(
                    event.payload.get(k) == v for k, v in payload_contains.items()
                ):
                    found = True
                    break
            assert found, (
                f"No {event_type} event found with payload containing {payload_contains}"
            )

    def assert_not_published(self, event_type: EventType) -> None:
        """
        Assert that no event of the given type was published.

        Args:
            event_type: Event type that should not have been published

        Raises:
            AssertionError if any events of this type were published
        """
        matching = self.eventbus.get_published_by_type(event_type)
        assert len(matching) == 0, (
            f"Expected no {event_type} events, got {len(matching)}"
        )

    def get_published(self, event_type: EventType) -> List[SwarmEvent]:
        """
        Get all published events of a specific type.

        Args:
            event_type: Event type to filter by

        Returns:
            List of matching events
        """
        return self.eventbus.get_published_by_type(event_type)

    def clear_events(self) -> None:
        """Clear all captured events."""
        self.eventbus.clear()
        self.published_events.clear()

    async def get_contact(self, contact_id: str) -> Optional[ContactState]:
        """
        Get a contact from the fake blackboard.

        Args:
            contact_id: Contact phone number

        Returns:
            ContactState or None
        """
        return await self.blackboard.get_contact(contact_id, owner_id=self.owner_id)


def contact_factory(
    phone_number: str = "1234567890",
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    email: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    company_name: Optional[str] = None,
    job_title: Optional[str] = None,
    research_status: str = "pending",
    qualification_tier: Optional[str] = None,
    qualification_score: Optional[int] = None,
    **kwargs: Any,
) -> ContactState:
    """
    Factory function to create ContactState instances for testing.

    Args:
        phone_number: Contact phone number
        first_name: First name
        last_name: Last name
        email: Email address
        linkedin_url: LinkedIn profile URL
        company_name: Company name
        job_title: Job title
        research_status: Research status
        qualification_tier: Qualification tier
        qualification_score: Qualification score
        **kwargs: Additional fields

    Returns:
        ContactState instance
    """
    return ContactState(
        phone_number=phone_number,
        first_name=first_name,
        last_name=last_name,
        email=email,
        linkedin_url=linkedin_url,
        company_name=company_name,
        job_title=job_title,
        research_status=research_status,
        qualification_tier=qualification_tier,
        qualification_score=qualification_score,
        **kwargs,
    )


def event_factory(
    event_type: EventType,
    contact_id: str = "1234567890",
    owner_id: str = "test-owner",
    payload: Optional[Dict[str, Any]] = None,
    source_agent: str = "test",
    correlation_id: Optional[str] = None,
) -> SwarmEvent:
    """
    Factory function to create SwarmEvent instances for testing.

    Args:
        event_type: Event type
        contact_id: Contact identifier
        owner_id: Owner identifier
        payload: Event payload
        source_agent: Source agent name
        correlation_id: Correlation ID

    Returns:
        SwarmEvent instance
    """
    event = SwarmEvent(
        event_type=event_type,
        contact_id=contact_id,
        owner_id=owner_id,
        payload=payload or {},
        source_agent=source_agent,
    )
    if correlation_id:
        event.correlation_id = correlation_id
    return event
