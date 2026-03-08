"""
Messaging Agent - Delivers outbound swarm messages to WhatsApp.

Subscribes to: message.send
Publishes: message.sent
"""

import os
import logging
import base64
from pathlib import Path
from typing import List

import httpx

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..blackboard import ContactState

logger = logging.getLogger(__name__)


class MessagingAgent(AutonomousAgent):
    """Agent that sends outbound messages via the API WhatsApp endpoint."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._api_base_url = os.getenv("NEXTHELLO_API_URL", "http://api:8001").rstrip("/")

    @property
    def name(self) -> str:
        return "messaging"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [EventType.MESSAGE_SEND]

    @property
    def requires_lock(self) -> bool:
        return False

    async def should_act(self, event: SwarmEvent, contact: ContactState) -> bool:
        if event.event_type != EventType.MESSAGE_SEND:
            return False

        text = str(event.payload.get("text") or "").strip()
        message_type = event.payload.get("message_type", "text")
        media_url = str(event.payload.get("media_url") or "").strip()

        if message_type == "text":
            return bool(text)

        if message_type == "audio":
            return bool(media_url)

        if message_type not in ("text", "audio"):
            logger.warning(
                "[messaging] Unsupported message_type for outbound send",
                extra={"message_type": message_type, "contact_id": event.contact_id},
            )
            return False

        return False

    async def execute(self, event: SwarmEvent, contact: ContactState) -> List[SwarmEvent]:
        text = str(event.payload.get("text") or "").strip()
        message_type = str(event.payload.get("message_type") or "text").strip().lower()
        media_url = str(event.payload.get("media_url") or "").strip()
        phone_number = "".join(
            ch for ch in str(contact.phone_number or event.contact_id) if ch.isdigit()
        )

        if not phone_number:
            logger.error("[messaging] Missing phone number for outbound send")
            return []

        try:
            if message_type == "audio":
                return await self._send_audio(event, phone_number, media_url, text)

            return await self._send_text(event, phone_number, text)
        except Exception as e:
            logger.error(f"[messaging] Error sending outbound message: {e}", exc_info=True)
            return []

    async def _send_text(self, event: SwarmEvent, phone_number: str, text: str) -> List[SwarmEvent]:
        url = f"{self._api_base_url}/admin/api/whatsapp/send"

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                url,
                json={
                    "phone_number": phone_number,
                    "content": text,
                },
            )

        if response.status_code != 200:
            logger.error(
                f"[messaging] Outbound send failed: HTTP {response.status_code} {response.text[:200]}"
            )
            return []

        payload = response.json()
        logger.info(
            "[messaging] Outbound message sent",
            extra={
                "phone_number": phone_number,
                "correlation_id": payload.get("correlationId"),
                "message_id": payload.get("messageId"),
                "via": payload.get("via"),
            },
        )

        return [
            event.create_response(
                event_type=EventType.MESSAGE_SENT,
                payload={
                    "phone_number": phone_number,
                    "message_id": payload.get("messageId"),
                    "correlation_id": payload.get("correlationId"),
                    "via": payload.get("via"),
                },
                source_agent=self.name,
            )
        ]

    async def _send_audio(
        self,
        event: SwarmEvent,
        phone_number: str,
        media_url: str,
        content: str,
    ) -> List[SwarmEvent]:
        audio_path = Path(media_url)
        if not audio_path.exists() or not audio_path.is_file():
            logger.error(f"[messaging] Audio file does not exist for outbound send: {media_url}")
            return []

        audio_bytes = audio_path.read_bytes()
        audio_base64 = base64.b64encode(audio_bytes).decode("ascii")

        suffix = audio_path.suffix.lower()
        mime_type = "audio/mpeg" if suffix == ".mp3" else "audio/ogg; codecs=opus"
        url = f"{self._api_base_url}/admin/api/whatsapp/send-voice"

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                url,
                json={
                    "phone_number": phone_number,
                    "audio_base64": audio_base64,
                    "mime_type": mime_type,
                    "content": content,
                },
            )

        if response.status_code != 200:
            logger.error(
                f"[messaging] Outbound voice send failed: HTTP {response.status_code} {response.text[:200]}"
            )
            return []

        payload = response.json()
        logger.info(
            "[messaging] Outbound voice note sent",
            extra={
                "phone_number": phone_number,
                "correlation_id": payload.get("correlationId"),
                "message_id": payload.get("messageId"),
                "via": payload.get("via"),
            },
        )

        return [
            event.create_response(
                event_type=EventType.MESSAGE_SENT,
                payload={
                    "phone_number": phone_number,
                    "message_id": payload.get("messageId"),
                    "correlation_id": payload.get("correlationId"),
                    "via": payload.get("via"),
                },
                source_agent=self.name,
            )
        ]
