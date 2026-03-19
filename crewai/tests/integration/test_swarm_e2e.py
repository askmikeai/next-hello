"""
End-to-end integration tests for the swarm system.

These tests verify the full message flow through the swarm architecture:
1. New contact: message -> research -> qualification -> video -> response
2. Returning contact: message -> response (no research)
3. High volume: concurrent messages without failures

These tests use fakes for external services but test the full internal flow.
"""

import pytest
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock

from tests.helpers.fakes import FakeEventBus, FakeBlackboard
from tests.helpers.agent_harness import event_factory, contact_factory

from src.swarm.events import EventType, SwarmEvent, ActionFlags
from src.swarm.blackboard import ContactState
from src.swarm.coordinator import SwarmCoordinator
from src.swarm.agent_runner import AgentPool


class TestNewContactFlow:
    """Tests for new contact message flow."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        return FakeBlackboard()

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_new_contact_publishes_contact_created(self, coordinator, eventbus):
        """New contact should trigger CONTACT_CREATED event."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hi, I'm John from Acme Corp",
            message_type="text",
            push_name="John Doe",
            owner_id="test-owner",
        )

        # Find CONTACT_CREATED event
        created_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.CONTACT_CREATED
        ]

        assert len(created_events) == 1
        assert created_events[0].event.contact_id == "1234567890"

    @pytest.mark.asyncio
    async def test_new_contact_publishes_message_received(self, coordinator, eventbus):
        """New contact should trigger MESSAGE_RECEIVED event."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hello there!",
            message_type="text",
            owner_id="test-owner",
        )

        # Find MESSAGE_RECEIVED event
        msg_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.MESSAGE_RECEIVED
        ]

        assert len(msg_events) == 1
        assert msg_events[0].event.payload["text"] == "Hello there!"
        assert msg_events[0].event.payload["is_new_contact"] is True

    @pytest.mark.asyncio
    async def test_new_contact_triggers_research(self, coordinator, eventbus):
        """New contact should trigger RESEARCH_NEEDED event."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hi!",
            message_type="text",
            owner_id="test-owner",
        )

        # Find RESEARCH_NEEDED event
        research_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.RESEARCH_NEEDED
        ]

        assert len(research_events) == 1
        assert research_events[0].event.payload.get("source") == "new_contact"

    @pytest.mark.asyncio
    async def test_new_contact_triggers_video_request(self, coordinator, eventbus):
        """New contact without video should trigger VIDEO_REQUESTED event."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hello!",
            message_type="text",
            owner_id="test-owner",
        )

        # Find VIDEO_REQUESTED event
        video_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.VIDEO_REQUESTED
        ]

        assert len(video_events) >= 1
        assert video_events[0].event.payload.get("welcome_video") is True

    @pytest.mark.asyncio
    async def test_new_contact_returns_welcome_response(self, coordinator):
        """New contact should receive a welcome response."""
        response = await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hi!",
            message_type="text",
            push_name="John",
            owner_id="test-owner",
        )

        assert response is not None
        assert "John" in response or "there" in response
        assert "welcome" in response.lower() or "meet" in response.lower()


class TestReturningContactFlow:
    """Tests for returning contact message flow."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        bb = FakeBlackboard()
        # Pre-populate with existing contact
        bb.contacts["test-owner:1234567890"] = ContactState(
            phone_number="1234567890",
            first_name="John",
            last_name="Doe",
            company_name="Acme Corp",
            research_status="complete",
            qualification_tier="warm",
            conversation_turns=5,
            welcomed=True,
        )
        return bb

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_returning_contact_no_contact_created(self, coordinator, eventbus):
        """Returning contact should NOT trigger CONTACT_CREATED event."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hey, following up!",
            message_type="text",
            owner_id="test-owner",
        )

        # Should NOT have CONTACT_CREATED event
        created_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.CONTACT_CREATED
        ]

        assert len(created_events) == 0

    @pytest.mark.asyncio
    async def test_returning_contact_publishes_message_received(self, coordinator, eventbus):
        """Returning contact should trigger MESSAGE_RECEIVED event."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Following up on our chat",
            message_type="text",
            owner_id="test-owner",
        )

        # Find MESSAGE_RECEIVED event
        msg_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.MESSAGE_RECEIVED
        ]

        assert len(msg_events) == 1
        assert msg_events[0].event.payload["is_new_contact"] is False

    @pytest.mark.asyncio
    async def test_returning_contact_no_research_needed(self, coordinator, eventbus):
        """Returning contact with complete research should NOT trigger RESEARCH_NEEDED."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hello again!",
            message_type="text",
            owner_id="test-owner",
        )

        # Should NOT have RESEARCH_NEEDED event for returning contact with complete research
        research_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.RESEARCH_NEEDED
        ]

        assert len(research_events) == 0

    @pytest.mark.asyncio
    async def test_returning_contact_no_welcome_response(self, coordinator):
        """Returning contact should NOT receive a welcome response."""
        response = await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hey there!",
            message_type="text",
            owner_id="test-owner",
        )

        # Should return None (no immediate response for returning contacts)
        assert response is None


class TestContactEntityExtraction:
    """Tests for entity extraction from messages."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        return FakeBlackboard()

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_extracts_email(self, coordinator, blackboard):
        """Should extract email from message."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="My email is john@example.com",
            message_type="text",
            owner_id="test-owner",
        )

        contact = blackboard.contacts.get("test-owner:1234567890")
        assert contact is not None
        assert contact.email == "john@example.com"

    @pytest.mark.asyncio
    async def test_extracts_linkedin(self, coordinator, blackboard):
        """Should extract LinkedIn URL from message."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Connect with me at linkedin.com/in/johndoe",
            message_type="text",
            owner_id="test-owner",
        )

        contact = blackboard.contacts.get("test-owner:1234567890")
        assert contact is not None
        assert "linkedin.com/in/johndoe" in contact.linkedin_url

    @pytest.mark.asyncio
    async def test_extracts_name(self, coordinator, blackboard):
        """Should extract name from introduction."""
        await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Hi, my name is John Smith",
            message_type="text",
            owner_id="test-owner",
        )

        contact = blackboard.contacts.get("test-owner:1234567890")
        assert contact is not None
        assert contact.first_name == "John"
        assert contact.last_name == "Smith"


class TestDataErasureFlow:
    """Tests for GDPR data erasure requests."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        bb = FakeBlackboard()
        bb.contacts["test-owner:1234567890"] = ContactState(
            phone_number="1234567890",
            first_name="John",
            email="john@example.com",
        )
        return bb

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_delete_my_data_request(self, coordinator, blackboard):
        """Should delete data when user requests it."""
        response = await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="Please delete my data",
            message_type="text",
            owner_id="test-owner",
        )

        assert response is not None
        assert "delete" in response.lower()

    @pytest.mark.asyncio
    async def test_right_to_be_forgotten(self, coordinator, blackboard):
        """Should handle 'right to be forgotten' request."""
        response = await coordinator.handle_incoming_message(
            phone_number="1234567890",
            message_text="I invoke my right to be forgotten",
            message_type="text",
            owner_id="test-owner",
        )

        assert response is not None
        assert "delete" in response.lower()


class TestHighVolumeProcessing:
    """Tests for high volume concurrent message handling."""

    @pytest.fixture
    def eventbus(self):
        return FakeEventBus()

    @pytest.fixture
    def blackboard(self):
        return FakeBlackboard()

    @pytest.fixture
    def coordinator(self, eventbus, blackboard):
        return SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

    @pytest.mark.asyncio
    async def test_concurrent_messages_no_failures(self, coordinator, eventbus):
        """Should handle 50 concurrent messages without failures."""
        async def send_message(i: int):
            return await coordinator.handle_incoming_message(
                phone_number=f"123456789{i:02d}",
                message_text=f"Hello from contact {i}",
                message_type="text",
                push_name=f"User {i}",
                owner_id="test-owner",
            )

        # Send 50 concurrent messages
        tasks = [send_message(i) for i in range(50)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Check no exceptions
        exceptions = [r for r in results if isinstance(r, Exception)]
        assert len(exceptions) == 0, f"Got {len(exceptions)} exceptions: {exceptions[:3]}"

        # Check events were published
        msg_events = [
            e for e in eventbus.published_events
            if e.event.event_type == EventType.MESSAGE_RECEIVED
        ]
        assert len(msg_events) == 50

    @pytest.mark.asyncio
    async def test_concurrent_messages_different_owners(self, coordinator, eventbus):
        """Should handle concurrent messages from different owners."""
        async def send_message(owner_i: int, contact_i: int):
            return await coordinator.handle_incoming_message(
                phone_number=f"123456789{contact_i:02d}",
                message_text=f"Hello from owner {owner_i} contact {contact_i}",
                message_type="text",
                owner_id=f"owner-{owner_i}",
            )

        # 5 owners, 10 contacts each = 50 messages
        tasks = [
            send_message(owner_i, contact_i)
            for owner_i in range(5)
            for contact_i in range(10)
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Check no exceptions
        exceptions = [r for r in results if isinstance(r, Exception)]
        assert len(exceptions) == 0


class TestActionFlagsIntegration:
    """Tests for ActionFlags integration with events."""

    def test_action_flags_in_message_received_payload(self):
        """ActionFlags should serialize correctly in event payload."""
        flags = ActionFlags(
            needs_research=True,
            needs_video=True,
        )

        event = SwarmEvent(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id="1234567890",
            owner_id="test-owner",
            payload={
                "text": "Hello!",
                "actions": flags.to_dict(),
            },
            source_agent="coordinator",
        )

        # Verify serialization
        event_dict = event.to_dict()
        assert event_dict["payload"]["actions"]["needs_research"] is True
        assert event_dict["payload"]["actions"]["needs_video"] is True
        assert event_dict["payload"]["actions"]["needs_voice"] is False

    def test_action_flags_roundtrip_via_json(self):
        """ActionFlags should survive JSON roundtrip."""
        flags = ActionFlags(
            needs_research=True,
            needs_qualification=True,
            needs_crm_sync=True,
        )

        event = SwarmEvent(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id="1234567890",
            owner_id="test-owner",
            payload={
                "text": "Test",
                "actions": flags.to_dict(),
            },
            source_agent="test",
        )

        # Serialize and deserialize
        json_str = event.to_json()
        restored = SwarmEvent.from_json(json_str)

        # Restore ActionFlags from payload
        restored_flags = ActionFlags.from_dict(restored.payload["actions"])

        assert restored_flags.needs_research is True
        assert restored_flags.needs_qualification is True
        assert restored_flags.needs_crm_sync is True
        assert restored_flags.needs_video is False
        assert restored_flags.needs_voice is False
