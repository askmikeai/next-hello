"""
Unit tests for VoiceAgent.

Tests the autonomous decision-making and execution of the voice agent
in isolation using fake backends.
"""

import pytest
from unittest.mock import AsyncMock, patch

from src.swarm.events import EventType
from src.swarm.blackboard import ContactState
from tests.helpers.agent_harness import contact_factory, event_factory


class TestVoiceAgentShouldAct:
    """Tests for VoiceAgent.should_act()"""

    @pytest.mark.asyncio
    async def test_should_act_on_voice_requested_with_script(self, voice_agent_harness):
        """Should act on VOICE_REQUESTED event with script."""
        contact = contact_factory(phone_number="1234567890")
        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello, this is a voice message!"},
        )

        result = await voice_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_not_act_on_voice_requested_without_script(
        self, voice_agent_harness
    ):
        """Should not act on VOICE_REQUESTED event without script."""
        contact = contact_factory(phone_number="1234567890")
        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={},
        )

        result = await voice_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_act_on_audio_message_in_voice_mode(self, voice_agent_harness):
        """Should act on audio MESSAGE_RECEIVED when contact is in voice mode."""
        contact = contact_factory(
            phone_number="1234567890",
            voice_mode=True,
        )
        event = event_factory(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id="1234567890",
            payload={"message_type": "audio"},
        )

        result = await voice_agent_harness.should_act(event, contact)

        assert result is True

    @pytest.mark.asyncio
    async def test_should_not_act_on_audio_message_not_in_voice_mode(
        self, voice_agent_harness
    ):
        """Should not act on audio message when contact is not in voice mode."""
        contact = contact_factory(
            phone_number="1234567890",
            voice_mode=False,
        )
        event = event_factory(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id="1234567890",
            payload={"message_type": "audio"},
        )

        result = await voice_agent_harness.should_act(event, contact)

        assert result is False

    @pytest.mark.asyncio
    async def test_should_not_act_on_text_message_in_voice_mode(
        self, voice_agent_harness
    ):
        """Should not act on text message even in voice mode."""
        contact = contact_factory(
            phone_number="1234567890",
            voice_mode=True,
        )
        event = event_factory(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id="1234567890",
            payload={"message_type": "text"},
        )

        result = await voice_agent_harness.should_act(event, contact)

        assert result is False


class TestVoiceAgentExecute:
    """Tests for VoiceAgent.execute()"""

    @pytest.mark.asyncio
    async def test_execute_publishes_voice_completed(self, voice_agent_harness):
        """Should publish VOICE_COMPLETED when ElevenLabs succeeds."""
        contact = contact_factory(phone_number="1234567890")
        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the ElevenLabs API call
        async def mock_generate(*args, **kwargs):
            return "/tmp/voice/test_audio.mp3"

        voice_agent_harness.agent._generate_voice = mock_generate

        result_events = await voice_agent_harness.execute(event, contact)

        event_types = [e.event_type for e in result_events]
        assert EventType.VOICE_COMPLETED in event_types

    @pytest.mark.asyncio
    async def test_execute_publishes_message_send(self, voice_agent_harness):
        """Should publish MESSAGE_SEND with audio after voice generation."""
        contact = contact_factory(phone_number="1234567890")
        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the ElevenLabs API call
        async def mock_generate(*args, **kwargs):
            return "/tmp/voice/test_audio.mp3"

        voice_agent_harness.agent._generate_voice = mock_generate

        result_events = await voice_agent_harness.execute(event, contact)

        event_types = [e.event_type for e in result_events]
        assert EventType.MESSAGE_SEND in event_types

        # Check MESSAGE_SEND payload
        message_send = [e for e in result_events if e.event_type == EventType.MESSAGE_SEND][0]
        assert message_send.payload["message_type"] == "audio"
        assert message_send.payload["media_url"] == "/tmp/voice/test_audio.mp3"

    @pytest.mark.asyncio
    async def test_execute_updates_contact_with_audio_url(self, voice_agent_harness):
        """Should update contact state with audio URL."""
        contact = contact_factory(phone_number="1234567890")
        voice_agent_harness.set_contact(contact)

        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the ElevenLabs API call
        async def mock_generate(*args, **kwargs):
            return "/tmp/voice/test_audio.mp3"

        voice_agent_harness.agent._generate_voice = mock_generate

        await voice_agent_harness.execute(event, contact)

        updated_contact = await voice_agent_harness.get_contact("1234567890")
        assert updated_contact.voice_audio_url == "/tmp/voice/test_audio.mp3"

    @pytest.mark.asyncio
    async def test_execute_returns_empty_without_script(self, voice_agent_harness):
        """Should return empty list if no script is available."""
        contact = contact_factory(phone_number="1234567890")
        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={},
        )

        result_events = await voice_agent_harness.execute(event, contact)

        assert len(result_events) == 0

    @pytest.mark.asyncio
    async def test_execute_returns_empty_for_message_without_script(
        self, voice_agent_harness
    ):
        """Should return empty list for MESSAGE_RECEIVED without script."""
        contact = contact_factory(
            phone_number="1234567890",
            voice_mode=True,
        )
        event = event_factory(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id="1234567890",
            payload={"message_type": "audio"},
        )

        result_events = await voice_agent_harness.execute(event, contact)

        assert len(result_events) == 0

    @pytest.mark.asyncio
    async def test_execute_handles_generation_failure(self, voice_agent_harness):
        """Should return empty list when voice generation fails."""
        contact = contact_factory(phone_number="1234567890")
        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the ElevenLabs API call to return None
        async def mock_generate(*args, **kwargs):
            return None

        voice_agent_harness.agent._generate_voice = mock_generate

        result_events = await voice_agent_harness.execute(event, contact)

        assert len(result_events) == 0

    @pytest.mark.asyncio
    async def test_execute_handles_exception(self, voice_agent_harness):
        """Should handle exceptions gracefully."""
        contact = contact_factory(phone_number="1234567890")
        event = event_factory(
            event_type=EventType.VOICE_REQUESTED,
            contact_id="1234567890",
            payload={"script": "Hello!"},
        )

        # Mock the ElevenLabs API call to raise exception
        async def mock_generate(*args, **kwargs):
            raise Exception("API error")

        voice_agent_harness.agent._generate_voice = mock_generate

        # Should not raise
        result_events = await voice_agent_harness.execute(event, contact)

        assert len(result_events) == 0


class TestVoiceAgentProperties:
    """Tests for VoiceAgent properties"""

    def test_agent_name(self, voice_agent_harness):
        """Agent name should be 'voice'."""
        assert voice_agent_harness.agent.name == "voice"

    def test_subscribed_events(self, voice_agent_harness):
        """Agent should subscribe to VOICE_REQUESTED and MESSAGE_RECEIVED."""
        expected = [
            EventType.VOICE_REQUESTED,
            EventType.MESSAGE_RECEIVED,
        ]
        assert voice_agent_harness.agent.subscribed_events == expected

    def test_does_not_require_lock(self, voice_agent_harness):
        """Voice agent should not require lock."""
        assert voice_agent_harness.agent.requires_lock is False
