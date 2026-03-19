"""
Unit tests for VideoAgent.

Tests the autonomous decision-making and execution of the video agent
in isolation using fake backends.
"""

import pytest
from unittest.mock import AsyncMock, patch

from src.swarm.events import EventType
from src.swarm.blackboard import ContactState
from tests.helpers.agent_harness import contact_factory, event_factory


class TestVideoAgentShouldAct:
    """Tests for VideoAgent.should_act()"""

    @pytest.mark.asyncio
    async def test_should_act_for_hot_lead_with_script(self, video_agent_harness):
        """Should act for hot lead with script in payload."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello, this is your personalized video!"},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_act_for_warm_lead_with_script(self, video_agent_harness):
        """Should act for warm lead with script in payload."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="warm",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello, this is your personalized video!"},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_not_act_for_cold_lead(self, video_agent_harness):
        """Should not act for cold lead without welcome_video flag."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="cold",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_act_for_welcome_video_cold_lead(self, video_agent_harness):
        """Should act for cold lead if welcome_video flag is set."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="cold",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Welcome!", "welcome_video": True},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_not_act_if_video_exists(self, video_agent_harness):
        """Should not act if contact already has a video."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
            heygen_video_url="https://example.com/video.mp4",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_not_act_if_video_in_progress(self, video_agent_harness):
        """Should not act if video generation is in progress."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
            heygen_video_id="video-123",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_not_act_without_script(self, video_agent_harness):
        """Should not act if no script is provided."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_act_with_script_from_contact_state(self, video_agent_harness):
        """Should act if script is available in contact state."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
            video_script="Hello from contact state!",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={},
        )

        result = await video_agent_harness.should_act(event, contact)

        assert result is True


class TestVideoAgentExecute:
    """Tests for VideoAgent.execute()"""

    @pytest.mark.asyncio
    async def test_execute_publishes_video_started_on_success(
        self, video_agent_harness
    ):
        """Should publish VIDEO_STARTED when HeyGen returns video ID."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello, this is your video!"},
        )

        # Mock the HeyGen API call
        async def mock_generate(*args, **kwargs):
            return "video-12345"

        video_agent_harness.agent._generate_video = mock_generate

        result_events = await video_agent_harness.execute(event, contact)

        event_types = [e.event_type for e in result_events]
        assert EventType.VIDEO_STARTED in event_types

    @pytest.mark.asyncio
    async def test_execute_includes_video_id_in_payload(self, video_agent_harness):
        """Should include video_id in VIDEO_STARTED payload."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the HeyGen API call
        async def mock_generate(*args, **kwargs):
            return "video-xyz-123"

        video_agent_harness.agent._generate_video = mock_generate

        result_events = await video_agent_harness.execute(event, contact)

        video_started = [e for e in result_events if e.event_type == EventType.VIDEO_STARTED][0]
        assert video_started.payload["video_id"] == "video-xyz-123"

    @pytest.mark.asyncio
    async def test_execute_updates_contact_with_video_id(self, video_agent_harness):
        """Should update contact state with video ID."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        video_agent_harness.set_contact(contact)

        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the HeyGen API call
        async def mock_generate(*args, **kwargs):
            return "video-updated-123"

        video_agent_harness.agent._generate_video = mock_generate

        await video_agent_harness.execute(event, contact)

        updated_contact = await video_agent_harness.get_contact("1234567890")
        assert updated_contact.heygen_video_id == "video-updated-123"

    @pytest.mark.asyncio
    async def test_execute_returns_empty_on_failure(self, video_agent_harness):
        """Should return empty list when video generation fails."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the HeyGen API call to return None (failure)
        async def mock_generate(*args, **kwargs):
            return None

        video_agent_harness.agent._generate_video = mock_generate

        result_events = await video_agent_harness.execute(event, contact)

        assert len(result_events) == 0

    @pytest.mark.asyncio
    async def test_execute_handles_exception(self, video_agent_harness):
        """Should handle exceptions gracefully."""
        contact = contact_factory(
            phone_number="1234567890",
            qualification_tier="hot",
        )
        event = event_factory(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the HeyGen API call to raise exception
        async def mock_generate(*args, **kwargs):
            raise Exception("API error")

        video_agent_harness.agent._generate_video = mock_generate

        # Should not raise exception
        result_events = await video_agent_harness.execute(event, contact)

        assert len(result_events) == 0


class TestVideoAgentProperties:
    """Tests for VideoAgent properties"""

    def test_agent_name(self, video_agent_harness):
        """Agent name should be 'video'."""
        assert video_agent_harness.agent.name == "video"

    def test_subscribed_events(self, video_agent_harness):
        """Agent should subscribe to VIDEO_REQUESTED and VIDEO_SCRIPT_READY."""
        expected = [
            EventType.VIDEO_REQUESTED,
            EventType.VIDEO_SCRIPT_READY,
        ]
        assert video_agent_harness.agent.subscribed_events == expected

    def test_requires_lock(self, video_agent_harness):
        """Agent should require lock by default."""
        assert video_agent_harness.agent.requires_lock is True
