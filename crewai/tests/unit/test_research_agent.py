"""
Unit tests for ResearchAgent.

Tests the autonomous decision-making and execution of the research agent
in isolation using fake backends.
"""

import pytest
from unittest.mock import AsyncMock, patch

from src.swarm.events import EventType
from src.swarm.blackboard import ContactState
from tests.helpers.agent_harness import contact_factory, event_factory


class TestResearchAgentShouldAct:
    """Tests for ResearchAgent.should_act()"""

    @pytest.mark.asyncio
    async def test_should_act_with_email(self, research_agent_harness):
        """Should act when contact has email and research is pending."""
        contact = contact_factory(
            phone_number="1234567890",
            email="test@example.com",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_act_with_linkedin(self, research_agent_harness):
        """Should act when contact has LinkedIn URL and research is pending."""
        contact = contact_factory(
            phone_number="1234567890",
            linkedin_url="https://linkedin.com/in/johndoe",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_not_act_when_research_complete(self, research_agent_harness):
        """Should not act when research is already complete."""
        contact = contact_factory(
            phone_number="1234567890",
            email="test@example.com",
            research_status="complete",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_not_act_when_research_in_progress(self, research_agent_harness):
        """Should not act when research is in progress."""
        contact = contact_factory(
            phone_number="1234567890",
            email="test@example.com",
            research_status="in_progress",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_not_act_without_email_or_linkedin(self, research_agent_harness):
        """Should not act when contact has no email or LinkedIn."""
        contact = contact_factory(
            phone_number="1234567890",
            first_name="John",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_act_on_research_needed_event(self, research_agent_harness):
        """Should act on explicit RESEARCH_NEEDED event even without email/linkedin."""
        contact = contact_factory(
            phone_number="1234567890",
            first_name="John",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.RESEARCH_NEEDED,
            contact_id="1234567890",
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_not_act_on_contact_updated_without_new_research_fields(
        self, research_agent_harness
    ):
        """Should not act on CONTACT_UPDATED if no new email/linkedin."""
        contact = contact_factory(
            phone_number="1234567890",
            email="test@example.com",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_UPDATED,
            contact_id="1234567890",
            payload={"updated_fields": ["first_name", "company_name"]},
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_act_on_contact_updated_with_new_email(
        self, research_agent_harness
    ):
        """Should act on CONTACT_UPDATED when email is updated."""
        contact = contact_factory(
            phone_number="1234567890",
            email="new@example.com",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_UPDATED,
            contact_id="1234567890",
            payload={"updated_fields": ["email"]},
        )

        result = await research_agent_harness.should_act(event, contact)

        assert result is True


class TestResearchAgentExecute:
    """Tests for ResearchAgent.execute()"""

    @pytest.mark.asyncio
    async def test_execute_publishes_research_completed_on_success(
        self, research_agent_harness, sample_research_data
    ):
        """Should publish RESEARCH_COMPLETED when PDL returns data."""
        contact = contact_factory(
            phone_number="1234567890",
            email="test@example.com",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        # Mock the PDL API call
        async def mock_enrich(*args, **kwargs):
            return sample_research_data

        research_agent_harness.agent._enrich_contact = mock_enrich

        result_events = await research_agent_harness.execute(event, contact)

        # Should have RESEARCH_COMPLETED and QUALIFICATION_NEEDED
        event_types = [e.event_type for e in result_events]
        assert EventType.RESEARCH_COMPLETED in event_types
        assert EventType.QUALIFICATION_NEEDED in event_types

    @pytest.mark.asyncio
    async def test_execute_publishes_research_failed_when_no_data(
        self, research_agent_harness
    ):
        """Should publish RESEARCH_FAILED when PDL returns no data."""
        contact = contact_factory(
            phone_number="1234567890",
            email="unknown@example.com",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        # Mock the PDL API call to return None
        async def mock_enrich(*args, **kwargs):
            return None

        research_agent_harness.agent._enrich_contact = mock_enrich

        result_events = await research_agent_harness.execute(event, contact)

        event_types = [e.event_type for e in result_events]
        assert EventType.RESEARCH_FAILED in event_types

    @pytest.mark.asyncio
    async def test_execute_updates_contact_with_research_data(
        self, research_agent_harness, sample_research_data
    ):
        """Should update contact state with research data."""
        contact = contact_factory(
            phone_number="1234567890",
            email="test@example.com",
            research_status="pending",
        )
        research_agent_harness.set_contact(contact)

        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        # Mock the PDL API call
        async def mock_enrich(*args, **kwargs):
            return sample_research_data

        research_agent_harness.agent._enrich_contact = mock_enrich

        await research_agent_harness.execute(event, contact)

        # Check that contact was updated
        updated_contact = await research_agent_harness.get_contact("1234567890")
        assert updated_contact.research_status == "complete"

    @pytest.mark.asyncio
    async def test_execute_handles_exception(self, research_agent_harness):
        """Should publish RESEARCH_FAILED when exception occurs."""
        contact = contact_factory(
            phone_number="1234567890",
            email="test@example.com",
            research_status="pending",
        )
        event = event_factory(
            event_type=EventType.CONTACT_CREATED,
            contact_id="1234567890",
        )

        # Mock the PDL API call to raise exception
        async def mock_enrich(*args, **kwargs):
            raise Exception("API error")

        research_agent_harness.agent._enrich_contact = mock_enrich

        result_events = await research_agent_harness.execute(event, contact)

        event_types = [e.event_type for e in result_events]
        assert EventType.RESEARCH_FAILED in event_types


class TestResearchAgentProperties:
    """Tests for ResearchAgent properties"""

    def test_agent_name(self, research_agent_harness):
        """Agent name should be 'research'."""
        assert research_agent_harness.agent.name == "research"

    def test_subscribed_events(self, research_agent_harness):
        """Agent should subscribe to CONTACT_CREATED, CONTACT_UPDATED, RESEARCH_NEEDED."""
        expected = [
            EventType.CONTACT_CREATED,
            EventType.CONTACT_UPDATED,
            EventType.RESEARCH_NEEDED,
        ]
        assert research_agent_harness.agent.subscribed_events == expected

    def test_requires_lock(self, research_agent_harness):
        """Agent should require lock by default."""
        assert research_agent_harness.agent.requires_lock is True
