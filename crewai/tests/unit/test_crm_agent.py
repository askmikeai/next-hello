"""
Unit tests for CRMAgent.

Tests the autonomous decision-making and execution of the CRM agent
in isolation using fake backends.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

from src.swarm.events import EventType
from src.swarm.blackboard import ContactState
from tests.helpers.agent_harness import contact_factory, event_factory


class TestCRMAgentShouldAct:
    """Tests for CRMAgent.should_act()"""

    @pytest.mark.asyncio
    async def test_should_act_for_qualified_contact(self, crm_agent_harness):
        """Should act for qualified contact that hasn't been synced recently."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        result = await crm_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_act_for_warm_contact(self, crm_agent_harness):
        """Should act for warm contact."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="warm",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        result = await crm_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_act_for_cold_contact(self, crm_agent_harness):
        """Should act for cold contact (still qualified, just not hot/warm)."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="cold",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        result = await crm_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_not_act_for_unqualified_contact(self, crm_agent_harness):
        """Should not act for unqualified contact."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="unqualified",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        result = await crm_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_not_act_if_synced_recently(self, crm_agent_harness):
        """Should not act if contact was synced within last 5 minutes."""
        recent_sync = (datetime.utcnow() - timedelta(minutes=2)).isoformat()
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
            crm_synced_at=recent_sync,
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        result = await crm_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_act_if_synced_over_5_minutes_ago(self, crm_agent_harness):
        """Should act if contact was synced more than 5 minutes ago."""
        old_sync = (datetime.utcnow() - timedelta(minutes=10)).isoformat()
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
            crm_synced_at=old_sync,
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        result = await crm_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_act_on_qualification_completed(self, crm_agent_harness):
        """Should act on QUALIFICATION_COMPLETED event."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="warm",
        )
        event = event_factory(
            event_type=EventType.QUALIFICATION_COMPLETED,
            contact_id="1234567890",
            payload={"tier": "warm", "score": 65},
        )

        result = await crm_agent_harness.should_act(event, contact)

        assert result is True


class TestCRMAgentExecute:
    """Tests for CRMAgent.execute()"""

    @pytest.mark.asyncio
    async def test_execute_publishes_crm_synced(self, crm_agent_harness):
        """Should publish CRM_SYNCED when HubSpot sync succeeds."""
        contact = contact_factory(
            phone_number="1234567890",
            first_name="John",
            last_name="Doe",
            email="john@example.com",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        # Mock the HubSpot API call
        async def mock_sync(*args, **kwargs):
            return "hubspot-contact-123"

        crm_agent_harness.agent._sync_contact = mock_sync
        crm_agent_harness.agent._create_deal = AsyncMock(return_value=None)
        crm_agent_harness.agent._add_note = AsyncMock(return_value=False)

        result_events = await crm_agent_harness.execute(event, contact)

        event_types = [e.event_type for e in result_events]
        assert EventType.CRM_SYNCED in event_types

    @pytest.mark.asyncio
    async def test_execute_includes_hubspot_id_in_payload(self, crm_agent_harness):
        """Should include hubspot_contact_id in CRM_SYNCED payload."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="warm",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        # Mock the HubSpot API call
        async def mock_sync(*args, **kwargs):
            return "hubspot-xyz-456"

        crm_agent_harness.agent._sync_contact = mock_sync
        crm_agent_harness.agent._create_deal = AsyncMock(return_value=None)
        crm_agent_harness.agent._add_note = AsyncMock(return_value=False)

        result_events = await crm_agent_harness.execute(event, contact)

        crm_synced = [e for e in result_events if e.event_type == EventType.CRM_SYNCED][0]
        assert crm_synced.payload["hubspot_contact_id"] == "hubspot-xyz-456"

    @pytest.mark.asyncio
    async def test_execute_creates_deal_for_hot_leads(self, crm_agent_harness):
        """Should create deal for hot leads."""
        contact = contact_factory(
            phone_number="1234567890",
            first_name="Jane",
            last_name="Smith",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        # Mock the HubSpot API calls
        async def mock_sync(*args, **kwargs):
            return "hubspot-contact-123"

        async def mock_deal(*args, **kwargs):
            return "deal-123"

        crm_agent_harness.agent._sync_contact = mock_sync
        crm_agent_harness.agent._create_deal = mock_deal
        crm_agent_harness.agent._add_note = AsyncMock(return_value=False)

        result_events = await crm_agent_harness.execute(event, contact)

        crm_synced = [e for e in result_events if e.event_type == EventType.CRM_SYNCED][0]
        assert crm_synced.payload["deal_created"] is True

    @pytest.mark.asyncio
    async def test_execute_updates_contact_with_hubspot_id(self, crm_agent_harness):
        """Should update contact state with HubSpot ID."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="warm",
        )
        crm_agent_harness.set_contact(contact)

        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        # Mock the HubSpot API call
        async def mock_sync(*args, **kwargs):
            return "hubspot-updated-123"

        crm_agent_harness.agent._sync_contact = mock_sync
        crm_agent_harness.agent._create_deal = AsyncMock(return_value=None)
        crm_agent_harness.agent._add_note = AsyncMock(return_value=False)

        await crm_agent_harness.execute(event, contact)

        updated_contact = await crm_agent_harness.get_contact("1234567890")
        assert updated_contact.hubspot_contact_id == "hubspot-updated-123"
        assert updated_contact.crm_synced_at is not None

    @pytest.mark.asyncio
    async def test_execute_returns_empty_on_sync_failure(self, crm_agent_harness):
        """Should return empty list when sync fails."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        # Mock the HubSpot API call to return None (failure)
        async def mock_sync(*args, **kwargs):
            return None

        crm_agent_harness.agent._sync_contact = mock_sync

        result_events = await crm_agent_harness.execute(event, contact)

        assert len(result_events) == 0

    @pytest.mark.asyncio
    async def test_execute_handles_exception(self, crm_agent_harness):
        """Should handle exceptions gracefully."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        # Mock the HubSpot API call to raise exception
        async def mock_sync(*args, **kwargs):
            raise Exception("API error")

        crm_agent_harness.agent._sync_contact = mock_sync

        # Should not raise
        result_events = await crm_agent_harness.execute(event, contact)

        assert len(result_events) == 0

    @pytest.mark.asyncio
    async def test_execute_adds_note_with_research_data(self, crm_agent_harness):
        """Should add note when contact has research data."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="warm",
            research_data={
                "job_title": "Software Engineer",
                "company_name": "TechCorp",
                "skills": ["Python", "ML"],
            },
        )
        event = event_factory(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id="1234567890",
        )

        # Mock the HubSpot API calls
        async def mock_sync(*args, **kwargs):
            return "hubspot-contact-123"

        async def mock_note(*args, **kwargs):
            return True

        crm_agent_harness.agent._sync_contact = mock_sync
        crm_agent_harness.agent._create_deal = AsyncMock(return_value=None)
        crm_agent_harness.agent._add_note = mock_note

        result_events = await crm_agent_harness.execute(event, contact)

        crm_synced = [e for e in result_events if e.event_type == EventType.CRM_SYNCED][0]
        assert crm_synced.payload["note_added"] is True


class TestCRMAgentProperties:
    """Tests for CRMAgent properties"""

    def test_agent_name(self, crm_agent_harness):
        """Agent name should be 'crm'."""
        assert crm_agent_harness.agent.name == "crm"

    def test_subscribed_events(self, crm_agent_harness):
        """Agent should subscribe to CRM_SYNC_NEEDED and QUALIFICATION_COMPLETED."""
        expected = [
            EventType.CRM_SYNC_NEEDED,
            EventType.QUALIFICATION_COMPLETED,
        ]
        assert crm_agent_harness.agent.subscribed_events == expected

    def test_requires_lock(self, crm_agent_harness):
        """Agent should require lock by default."""
        assert crm_agent_harness.agent.requires_lock is True
