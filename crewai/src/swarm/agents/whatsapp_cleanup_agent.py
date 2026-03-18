"""
WhatsApp Cleanup Agent - Deletes outbound WhatsApp messages when enabled.

Subscribes to: message.sent
Publishes: none
"""

import os
import logging
from typing import List

import httpx

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..blackboard import ContactState

logger = logging.getLogger(__name__)


class WhatsAppCleanupAgent(AutonomousAgent):
    """Agent that revokes bot-sent WhatsApp messages when owner toggle is enabled."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._api_base_url = os.getenv("NEXTHELLO_API_URL", "http://api:8001").rstrip("/")

    @property
    def name(self) -> str:
        return "whatsapp-cleanup"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [EventType.MESSAGE_SENT]

    @property
    def requires_lock(self) -> bool:
        return False

    def _owner_headers(self, event: SwarmEvent) -> dict:
        owner = event.owner_id or ""
        if owner:
            return {"X-NextHello-User": owner}
        return {}

    async def should_act(self, event: SwarmEvent, contact: ContactState) -> bool:
        if event.event_type != EventType.MESSAGE_SENT:
            return False

        cfg = await self.get_owner_config(event.owner_id)
        behavior = cfg.behavior if cfg else {}
        enabled = bool(behavior.get("whatsapp_auto_delete_enabled", False))
        if not enabled:
            return False

        message_id = str(
            event.payload.get("message_id") or event.payload.get("messageId") or ""
        ).strip()
        if not message_id:
            return False

        via = str(event.payload.get("via") or "").strip().lower()
        if via and via != "baileys":
            return False

        phone_number = "".join(
            ch for ch in str(event.payload.get("phone_number") or "") if ch.isdigit()
        )
        return bool(phone_number)

    async def execute(self, event: SwarmEvent, contact: ContactState) -> List[SwarmEvent]:
        phone_number = "".join(
            ch for ch in str(event.payload.get("phone_number") or "") if ch.isdigit()
        )
        message_id = str(
            event.payload.get("message_id") or event.payload.get("messageId") or ""
        ).strip()

        if not phone_number or not message_id:
            return []

        url = f"{self._api_base_url}/admin/api/whatsapp/delete"

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    url,
                    json={
                        "phone_number": phone_number,
                        "message_id": message_id,
                    },
                    headers=self._owner_headers(event),
                )

            if response.status_code != 200:
                logger.warning(
                    "[whatsapp-cleanup] Delete failed",
                    extra={
                        "phone_number": phone_number,
                        "message_id": message_id,
                        "status": response.status_code,
                        "body": response.text[:200],
                    },
                )
                return []

            logger.info(
                "[whatsapp-cleanup] Deleted outbound WhatsApp message",
                extra={
                    "phone_number": phone_number,
                    "message_id": message_id,
                },
            )
        except Exception as e:
            logger.warning(
                "[whatsapp-cleanup] Delete request failed",
                extra={
                    "phone_number": phone_number,
                    "message_id": message_id,
                    "error": str(e),
                },
            )

        return []
