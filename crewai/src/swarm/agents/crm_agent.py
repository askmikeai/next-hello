"""
CRM Agent - HubSpot synchronization

Subscribes to: crm.sync_needed, qualification.completed
Publishes: crm.synced
"""

import os
import logging
from typing import List
from datetime import datetime, timedelta

import httpx

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..eventbus import EventBus
from ..blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)


class CRMAgent(AutonomousAgent):
    """
    Autonomous agent for CRM synchronization.

    Syncs qualified contacts to HubSpot:
    - Creates/updates contacts
    - Creates deals for hot leads
    - Adds notes with context

    Autonomy logic:
    - Only syncs qualified leads (not unqualified)
    - Rate limits syncs to prevent excessive updates
    """

    @property
    def name(self) -> str:
        return "crm"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [
            EventType.CRM_SYNC_NEEDED,
            EventType.QUALIFICATION_COMPLETED,
        ]

    async def should_act(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> bool:
        """
        Decide if we should sync to CRM.

        Conditions for acting:
        1. Contact is not unqualified
        2. Haven't synced in the last 5 minutes (rate limit)
        """
        # Skip unqualified leads
        if contact.qualification_tier == "unqualified":
            logger.debug(f"[{self.name}] Skipping - contact is unqualified")
            return False

        # Rate limit syncs
        if contact.crm_synced_at:
            try:
                last_sync = datetime.fromisoformat(contact.crm_synced_at)
                if datetime.utcnow() - last_sync < timedelta(minutes=5):
                    logger.debug(f"[{self.name}] Skipping - synced recently")
                    return False
            except (ValueError, TypeError):
                pass

        return True

    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute CRM synchronization.
        """
        result_events = []

        cfg = await self.get_owner_config(event.owner_id)

        try:
            # Sync contact to HubSpot
            contact_id = await self._sync_contact(contact, cfg)

            if contact_id:
                # Update contact with HubSpot ID
                await self.blackboard.update_contact(
                    contact.phone_number,
                    owner_id=event.owner_id,
                    hubspot_contact_id=contact_id,
                    crm_synced_at=datetime.utcnow().isoformat(),
                )

                # Create deal for hot leads
                deal_created = False
                if contact.qualification_tier == "hot":
                    deal_id = await self._create_deal(contact_id, contact)
                    deal_created = bool(deal_id)

                # Add note with context
                note_added = False
                if contact.research_data:
                    note_added = await self._add_note(contact_id, contact)

                # Publish crm.synced
                result_events.append(
                    event.create_response(
                        event_type=EventType.CRM_SYNCED,
                        payload={
                            "hubspot_contact_id": contact_id,
                            "deal_created": deal_created,
                            "note_added": note_added,
                        },
                        source_agent=self.name,
                    )
                )

                logger.info(
                    f"[{self.name}] Synced {contact.phone_number} to HubSpot: "
                    f"contact_id={contact_id}"
                )

        except Exception as e:
            logger.error(f"[{self.name}] CRM sync failed: {e}")

        return result_events

    async def _sync_contact(self, contact: ContactState, cfg=None) -> str | None:
        """
        Create or update contact in HubSpot.

        Returns HubSpot contact ID or None on failure.
        """
        crm = cfg.crm if cfg else {}
        api_key = crm.get("hubspot_api_key") or os.getenv("HUBSPOT_API_KEY")
        # Store for use by _create_deal / _add_note
        self._hubspot_api_key = api_key
        if not api_key:
            logger.warning("HUBSPOT_API_KEY not configured")
            return None

        # Build properties
        properties = {"phone": contact.phone_number}
        if contact.email:
            properties["email"] = contact.email
        if contact.first_name:
            properties["firstname"] = contact.first_name
        if contact.last_name:
            properties["lastname"] = contact.last_name
        if contact.company_name:
            properties["company"] = contact.company_name
        if contact.job_title:
            properties["jobtitle"] = contact.job_title
        if contact.linkedin_url:
            properties["linkedin_profile"] = contact.linkedin_url

        # Add qualification as custom property (if configured in HubSpot)
        if contact.qualification_tier:
            properties["qualification_tier"] = contact.qualification_tier
        if contact.qualification_score:
            properties["qualification_score"] = str(contact.qualification_score)

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Check for existing contact
                existing_id = contact.hubspot_contact_id

                # Try to find by email if no existing ID
                if not existing_id and contact.email:
                    search_response = await client.post(
                        "https://api.hubapi.com/crm/v3/objects/contacts/search",
                        headers=headers,
                        json={
                            "filterGroups": [
                                {
                                    "filters": [
                                        {
                                            "propertyName": "email",
                                            "operator": "EQ",
                                            "value": contact.email,
                                        }
                                    ]
                                }
                            ]
                        },
                    )
                    if search_response.status_code == 200:
                        results = search_response.json().get("results", [])
                        if results:
                            existing_id = results[0]["id"]

                if existing_id:
                    # Update existing contact
                    response = await client.patch(
                        f"https://api.hubapi.com/crm/v3/objects/contacts/{existing_id}",
                        headers=headers,
                        json={"properties": properties},
                    )
                else:
                    # Create new contact
                    response = await client.post(
                        "https://api.hubapi.com/crm/v3/objects/contacts",
                        headers=headers,
                        json={"properties": properties},
                    )

                if response.status_code not in [200, 201]:
                    logger.error(f"[{self.name}] HubSpot error: {response.status_code}")
                    return None

                data = response.json()
                return data.get("id")

        except httpx.TimeoutException:
            logger.error(f"[{self.name}] HubSpot request timed out")
            return None
        except Exception as e:
            logger.error(f"[{self.name}] HubSpot error: {e}")
            return None

    async def _create_deal(
        self,
        contact_id: str,
        contact: ContactState,
    ) -> str | None:
        """
        Create a deal for a hot lead.

        Returns deal ID or None on failure.
        """
        api_key = getattr(self, "_hubspot_api_key", None) or os.getenv("HUBSPOT_API_KEY")
        if not api_key:
            return None

        name = f"{contact.first_name or 'Contact'} {contact.last_name or ''}".strip()
        company = contact.company_name or "Unknown"
        deal_name = f"{name} - {company}"

        properties = {"dealname": deal_name}

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Create deal
                response = await client.post(
                    "https://api.hubapi.com/crm/v3/objects/deals",
                    headers=headers,
                    json={"properties": properties},
                )

                if response.status_code not in [200, 201]:
                    logger.error(f"[{self.name}] Failed to create deal")
                    return None

                data = response.json()
                deal_id = data.get("id")

                # Associate with contact
                await client.put(
                    f"https://api.hubapi.com/crm/v3/objects/deals/{deal_id}/associations/contacts/{contact_id}/deal_to_contact",
                    headers=headers,
                )

                return deal_id

        except Exception as e:
            logger.error(f"[{self.name}] Deal creation error: {e}")
            return None

    async def _add_note(
        self,
        contact_id: str,
        contact: ContactState,
    ) -> bool:
        """
        Add a note with research context.
        """
        api_key = getattr(self, "_hubspot_api_key", None) or os.getenv("HUBSPOT_API_KEY")
        if not api_key:
            return False

        research = contact.research_data or {}

        # Build note content
        lines = [f"Contact qualified as {contact.qualification_tier} lead."]

        if contact.qualification_score:
            lines.append(f"Score: {contact.qualification_score}/100")

        if research.get("job_title"):
            lines.append(f"Title: {research['job_title']}")
        if research.get("company_name"):
            lines.append(f"Company: {research['company_name']}")
        if research.get("company_industry"):
            lines.append(f"Industry: {research['company_industry']}")
        if research.get("skills"):
            lines.append(f"Skills: {', '.join(research['skills'][:5])}")

        lines.append(f"\nConversation turns: {contact.conversation_turns}")
        lines.append(f"Source: WhatsApp networking")

        note_body = "\n".join(lines)

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # Create note
                import time

                response = await client.post(
                    "https://api.hubapi.com/crm/v3/objects/notes",
                    headers=headers,
                    json={
                        "properties": {
                            "hs_note_body": note_body,
                            "hs_timestamp": str(int(time.time() * 1000)),
                        }
                    },
                )

                if response.status_code not in [200, 201]:
                    return False

                data = response.json()
                note_id = data.get("id")

                # Associate with contact
                await client.put(
                    f"https://api.hubapi.com/crm/v3/objects/notes/{note_id}/associations/contacts/{contact_id}/note_to_contact",
                    headers=headers,
                )

                return True

        except Exception as e:
            logger.error(f"[{self.name}] Note creation error: {e}")
            return False
