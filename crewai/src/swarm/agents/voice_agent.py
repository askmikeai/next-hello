"""
Voice Agent - ElevenLabs voice message generation

Subscribes to: voice.requested, message.received (voice mode)
Publishes: voice.completed, message.send
"""

import os
import logging
import uuid
from pathlib import Path
from typing import List

import httpx

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..eventbus import EventBus
from ..blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)


class VoiceAgent(AutonomousAgent):
    """
    Autonomous agent for voice message generation using ElevenLabs.

    Generates personalized voice messages for contacts.
    Can also respond in voice mode when contact prefers voice.

    Autonomy logic:
    - Acts on explicit voice requests
    - Acts when contact is in voice_mode and sends voice message
    """

    @property
    def name(self) -> str:
        return "voice"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [
            EventType.VOICE_REQUESTED,
            EventType.MESSAGE_RECEIVED,
        ]

    async def should_act(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> bool:
        """
        Decide if we should generate a voice message.

        Conditions for acting:
        1. For voice.requested: always act if script available
        2. For message.received: only if contact is in voice_mode
        """
        # Always act on explicit voice requests with script
        if event.event_type == EventType.VOICE_REQUESTED:
            script = event.payload.get("script")
            return bool(script)

        # For messages, check if contact prefers voice
        if event.event_type == EventType.MESSAGE_RECEIVED:
            # Only respond in voice if contact is in voice mode
            if not contact.voice_mode:
                return False

            # Check if incoming message was audio
            message_type = event.payload.get("message_type", "text")
            if message_type == "audio":
                return True

        return False

    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute voice generation via ElevenLabs.
        """
        result_events = []

        # Get or generate script
        script = event.payload.get("script")

        # For voice mode responses, we need to generate a script
        if not script and event.event_type == EventType.MESSAGE_RECEIVED:
            # Would need transcription of incoming audio + response generation
            # For now, skip - personalization agent handles this
            return result_events

        if not script:
            logger.error(f"[{self.name}] No script available for {contact.phone_number}")
            return result_events

        try:
            # Generate voice
            audio_url = await self._generate_voice(contact.phone_number, script)

            if audio_url:
                # Update contact
                await self.blackboard.update_contact(
                    contact.phone_number,
                    voice_audio_url=audio_url,
                )

                # Publish voice.completed
                result_events.append(event.create_response(
                    event_type=EventType.VOICE_COMPLETED,
                    payload={
                        "audio_url": audio_url,
                        "script": script,
                    },
                    source_agent=self.name,
                ))

                # Request message send with audio
                result_events.append(event.create_response(
                    event_type=EventType.MESSAGE_SEND,
                    payload={
                        "message_type": "audio",
                        "media_url": audio_url,
                        "text": "",  # No caption for voice messages
                    },
                    source_agent=self.name,
                ))

                logger.info(f"[{self.name}] Voice generated for {contact.phone_number}")

        except Exception as e:
            logger.error(f"[{self.name}] Voice generation failed: {e}")

        return result_events

    async def _generate_voice(
        self,
        phone_number: str,
        script: str,
    ) -> str | None:
        """
        Generate a voice message using ElevenLabs.

        Returns the path/URL to the audio file or None on failure.
        """
        api_key = os.getenv("ELEVENLABS_API_KEY")
        if not api_key:
            logger.warning("ELEVENLABS_API_KEY not configured")
            return None

        voice_id = os.getenv("ELEVENLABS_VOICE_ID")
        if not voice_id:
            logger.warning("ELEVENLABS_VOICE_ID not configured")
            return None

        # Setup output directory
        output_dir = os.getenv("VOICE_OUTPUT_DIR", "/tmp/voice")
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # Generate unique filename
        filename = f"voice_{phone_number.replace('+', '')}_{uuid.uuid4().hex[:8]}.mp3"
        file_path = output_path / filename

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                    headers={
                        "Accept": "audio/mpeg",
                        "Content-Type": "application/json",
                        "xi-api-key": api_key,
                    },
                    json={
                        "text": script,
                        "model_id": "eleven_monolingual_v1",
                        "voice_settings": {
                            "stability": 0.5,
                            "similarity_boost": 0.75,
                        },
                    },
                )

                if response.status_code != 200:
                    logger.error(f"[{self.name}] ElevenLabs error: {response.status_code}")
                    return None

                # Save audio file
                with open(file_path, "wb") as f:
                    f.write(response.content)

                logger.info(f"[{self.name}] Voice saved to {file_path}")

                # For production, you'd upload to cloud storage
                # and return a public URL. For now, return local path.
                return str(file_path)

        except httpx.TimeoutException:
            logger.error(f"[{self.name}] ElevenLabs request timed out")
            return None
        except Exception as e:
            logger.error(f"[{self.name}] ElevenLabs error: {e}")
            return None
