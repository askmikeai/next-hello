"""
Messaging Agent - Delivers outbound swarm messages to WhatsApp.

Subscribes to: message.send
Publishes: message.sent
"""

import os
import logging
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

        if message_type != "text":
            logger.warning(
                "[messaging] Unsupported message_type for outbound send",
                extra={"message_type": message_type, "contact_id": event.contact_id},
            )
            return False

        return bool(text)

    async def execute(self, event: SwarmEvent, contact: ContactState) -> List[SwarmEvent]:
        text = str(event.payload.get("text") or "").strip()
        phone_number = "".join(
            ch for ch in str(contact.phone_number or event.contact_id) if ch.isdigit()
        )

        if not phone_number:
            logger.error("[messaging] Missing phone number for outbound send")
            return []

        url = f"{self._api_base_url}/admin/api/whatsapp/send"

        try:
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
        except Exception as e:
            logger.error(f"[messaging] Error sending outbound message: {e}", exc_info=True)
            return []
