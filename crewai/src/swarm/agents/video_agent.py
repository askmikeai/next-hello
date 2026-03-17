"""
Video Agent - HeyGen video generation

Subscribes to: video.requested, video.script_ready
Publishes: video.started, video.completed
"""

import os
import logging
from typing import List

import httpx

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..eventbus import EventBus
from ..blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)

SYSTEM_OWNER_ID = (
    os.getenv("NEXTHELLO_SYSTEM_OWNER_ID")
    or os.getenv("NEXTHELLO_DEFAULT_OWNER_ID")
    or "askmikeai@gmail.com"
)


class VideoAgent(AutonomousAgent):
    """
    Autonomous agent for video generation using HeyGen.

    Generates personalized AI avatar videos for qualified leads.

    Autonomy logic:
    - Only acts for hot/warm leads
    - Skips if video already exists
    - Requires script (from personalization agent or event payload)
    """

    @property
    def name(self) -> str:
        return "video"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [
            EventType.VIDEO_REQUESTED,
            EventType.VIDEO_SCRIPT_READY,
        ]

    async def should_act(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> bool:
        """
        Decide if we should generate a video.

        Conditions for acting:
        1. Contact doesn't already have a video
        2. Contact is hot or warm tier
        3. Script is available (from payload or contact state)
        """
        # Skip if video already exists
        if contact.heygen_video_url:
            logger.debug(f"[{self.name}] Skipping - video already exists")
            return False

        # Skip if video already in progress
        if contact.heygen_video_id:
            logger.debug(f"[{self.name}] Skipping - video generation in progress")
            return False

        is_welcome_video = bool(event.payload.get("welcome_video"))

        # Only generate for qualified leads unless this is a first-contact welcome video
        tier = contact.qualification_tier
        if not is_welcome_video and tier not in ["hot", "warm"]:
            logger.debug(f"[{self.name}] Skipping - tier {tier} not qualified for video")
            return False

        # Need a script
        script = event.payload.get("script") or contact.video_script
        if not script:
            logger.debug(f"[{self.name}] Skipping - no script available")
            return False

        return True

    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute video generation via HeyGen.
        """
        result_events = []

        # Get script from payload or contact state
        script = event.payload.get("script") or contact.video_script

        if not script:
            logger.error(f"[{self.name}] No script available for {contact.phone_number}")
            return result_events

        cfg = await self.get_owner_config(event.owner_id)

        try:
            # Generate video
            video_id = await self._generate_video(contact.phone_number, script, cfg)

            if video_id:
                # Update contact with video ID (URL will come via webhook)
                await self.blackboard.update_contact(
                    contact.phone_number,
                    owner_id=event.owner_id,
                    heygen_video_id=video_id,
                )

                # Publish video.started
                result_events.append(
                    event.create_response(
                        event_type=EventType.VIDEO_STARTED,
                        payload={
                            "video_id": video_id,
                            "script_length": len(script),
                        },
                        source_agent=self.name,
                    )
                )

                logger.info(
                    f"[{self.name}] Video generation started for {contact.phone_number}: "
                    f"video_id={video_id}"
                )

        except Exception as e:
            logger.error(f"[{self.name}] Video generation failed: {e}")

        return result_events

    async def _generate_video(
        self,
        phone_number: str,
        script: str,
        cfg=None,
    ) -> str | None:
        """
        Generate a HeyGen video.

        Returns video_id or None on failure.
        """
        hg = cfg.heygen if cfg else {}
        beh = cfg.behavior if cfg else {}
        api_key = hg.get("api_key") or os.getenv("HEYGEN_API_KEY")
        if not api_key:
            logger.warning("HEYGEN_API_KEY not configured")
            return None

        avatar_id = hg.get("avatar_id") or os.getenv("HEYGEN_AVATAR_ID")
        voice_id = hg.get("voice_id") or os.getenv("HEYGEN_VOICE_ID")

        if not avatar_id or not voice_id:
            logger.warning("HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID must be set")
            return None

        # Build webhook URL
        webhook_url = None
        base_url = beh.get("webhook_base_url") or os.getenv("WEBHOOK_BASE_URL")
        if base_url:
            webhook_url = f"{base_url}/webhooks/networking-event/heygen"

        request_body = {
            "video_inputs": [
                {
                    "character": {
                        "type": "avatar",
                        "avatar_id": avatar_id,
                        "avatar_style": "normal",
                    },
                    "voice": {
                        "type": "text",
                        "voice_id": voice_id,
                        "input_text": script,
                    },
                }
            ],
            "dimension": {"width": 1280, "height": 720},
            "callback_id": phone_number,
        }

        if webhook_url:
            request_body["callback_url"] = webhook_url

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    "https://api.heygen.com/v2/video/generate",
                    headers={
                        "Content-Type": "application/json",
                        "X-Api-Key": api_key,
                    },
                    json=request_body,
                )

                if response.status_code != 200:
                    logger.error(f"[{self.name}] HeyGen error: {response.status_code}")
                    return None

                data = response.json()

                if data.get("error"):
                    logger.error(f"[{self.name}] HeyGen error: {data['error']}")
                    return None

                return data.get("data", {}).get("video_id")

        except httpx.TimeoutException:
            logger.error(f"[{self.name}] HeyGen request timed out")
            return None
        except Exception as e:
            logger.error(f"[{self.name}] HeyGen error: {e}")
            return None

    async def handle_webhook(
        self,
        video_id: str,
        video_url: str,
        callback_id: str,
        owner_id: str = SYSTEM_OWNER_ID,
    ) -> List[SwarmEvent]:
        """
        Handle HeyGen webhook callback when video is ready.

        This should be called from the webhook endpoint.
        """
        # Update contact with video URL
        await self.blackboard.update_contact(
            callback_id,
            owner_id=owner_id,
            heygen_video_url=video_url,
        )

        # Create and publish video.completed event
        event = SwarmEvent(
            event_type=EventType.VIDEO_COMPLETED,
            contact_id=callback_id,
            owner_id=owner_id,
            payload={
                "video_id": video_id,
                "video_url": video_url,
            },
            source_agent=self.name,
        )

        await self.eventbus.publish(event)

        logger.info(f"[{self.name}] Video completed for {callback_id}: {video_url}")

        return [event]
