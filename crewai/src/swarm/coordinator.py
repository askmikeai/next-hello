"""
Swarm Coordinator - Lightweight Message Router

The coordinator is NOT an orchestrator. It only:
- Receives external messages (WhatsApp, API)
- Converts them to swarm events
- Publishes to the event bus

Agents decide independently what to do with events.
"""

import os
import re
import logging
from typing import Optional
from datetime import datetime

from .events import SwarmEvent, EventType
from .eventbus import EventBus
from .blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)


class SwarmCoordinator:
    """
    Lightweight coordinator for external message routing.

    This class does NOT orchestrate agents. It simply:
    1. Receives external input (WhatsApp messages, API calls)
    2. Extracts entities from messages
    3. Publishes appropriate events to the bus
    4. Generates immediate responses if needed

    Agents subscribe to events and act autonomously.
    """

    def __init__(
        self,
        eventbus: EventBus,
        blackboard: Blackboard,
    ):
        self.eventbus = eventbus
        self.blackboard = blackboard

    async def connect(self) -> None:
        """Connect to Redis and database"""
        await self.eventbus.connect()
        await self.blackboard.connect()

    async def close(self) -> None:
        """Close connections"""
        await self.eventbus.close()
        await self.blackboard.close()

    async def handle_incoming_message(
        self,
        phone_number: str,
        message_text: str,
        message_type: str = "text",
        push_name: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Optional[str]:
        """
        Handle an incoming WhatsApp message.

        This method:
        1. Gets or creates contact state
        2. Extracts entities from the message
        3. Publishes appropriate events
        4. Returns an immediate response if this is a new contact

        Args:
            phone_number: Sender's phone number
            message_text: Message content
            message_type: Type of message (text, audio, etc.)
            push_name: WhatsApp display name
            message_id: WhatsApp message ID

        Returns:
            Optional immediate response text
        """
        logger.info(f"Processing message from {phone_number}: {message_text[:50]}...")

        # Get or create contact state
        contact = await self.blackboard.get_contact(phone_number)
        is_new_contact = contact is None

        if is_new_contact:
            contact = ContactState(
                phone_number=phone_number,
                push_name=push_name,
            )
            await self.blackboard.save_contact(contact)

            # Publish contact.created event
            await self.eventbus.publish(SwarmEvent(
                event_type=EventType.CONTACT_CREATED,
                contact_id=phone_number,
                payload={
                    "push_name": push_name,
                    "source": "whatsapp",
                },
                source_agent="coordinator",
            ))

        # Extract entities from message
        entities = self._extract_entities(message_text)

        # Update contact with extracted info
        updated_fields = {}
        if entities.get("email") and not contact.email:
            updated_fields["email"] = entities["email"]
        if entities.get("linkedin_url") and not contact.linkedin_url:
            updated_fields["linkedin_url"] = entities["linkedin_url"]
        if entities.get("first_name") and not contact.first_name:
            updated_fields["first_name"] = entities["first_name"]
        if entities.get("last_name") and not contact.last_name:
            updated_fields["last_name"] = entities["last_name"]
        if entities.get("company_name") and not contact.company_name:
            updated_fields["company_name"] = entities["company_name"]
        if entities.get("job_title") and not contact.job_title:
            updated_fields["job_title"] = entities["job_title"]

        # Update push_name if we got it
        if push_name and not contact.push_name:
            updated_fields["push_name"] = push_name

        # Increment conversation turns
        updated_fields["conversation_turns"] = contact.conversation_turns + 1
        updated_fields["last_message_at"] = datetime.utcnow().isoformat()
        updated_fields["last_message_text"] = message_text[:500]

        if updated_fields:
            contact = await self.blackboard.update_contact(phone_number, **updated_fields)

            # If contact info changed, publish update event
            if any(k in updated_fields for k in ["email", "linkedin_url", "first_name", "company_name"]):
                await self.eventbus.publish(SwarmEvent(
                    event_type=EventType.CONTACT_UPDATED,
                    contact_id=phone_number,
                    payload={
                        "updated_fields": list(updated_fields.keys()),
                        "entities": entities,
                    },
                    source_agent="coordinator",
                ))

        # Detect intent
        intent = self._detect_intent(message_text)

        # Publish message.received event
        await self.eventbus.publish(SwarmEvent(
            event_type=EventType.MESSAGE_RECEIVED,
            contact_id=phone_number,
            payload={
                "text": message_text,
                "message_type": message_type,
                "message_id": message_id,
                "intent": intent,
                "entities": entities,
                "is_new_contact": is_new_contact,
            },
            source_agent="coordinator",
        ))

        # Generate immediate response for new contacts
        # The Personalization Agent will handle actual responses via message.send
        if is_new_contact and not contact.welcomed:
            await self.blackboard.update_contact(phone_number, welcomed=True)
            name = push_name or contact.first_name or "there"
            owner_name = os.getenv("OWNER_NAME", "I")
            return (
                f"Hey {name}! Great to connect with you. "
                f"I'm {owner_name}'s assistant - happy to chat and help however I can. "
                f"What brings you here today?"
            )

        return None

    async def request_send_message(
        self,
        phone_number: str,
        text: str,
        message_type: str = "text",
        media_url: Optional[str] = None,
    ) -> None:
        """
        Request to send a message to a contact.

        Publishes message.send event for the messaging agent to handle.
        """
        await self.eventbus.publish(SwarmEvent(
            event_type=EventType.MESSAGE_SEND,
            contact_id=phone_number,
            payload={
                "text": text,
                "message_type": message_type,
                "media_url": media_url,
            },
            source_agent="coordinator",
        ))

    async def request_research(self, phone_number: str) -> None:
        """Request research for a contact"""
        await self.eventbus.publish(SwarmEvent(
            event_type=EventType.RESEARCH_NEEDED,
            contact_id=phone_number,
            payload={},
            source_agent="coordinator",
        ))

    async def request_qualification(self, phone_number: str) -> None:
        """Request qualification for a contact"""
        await self.eventbus.publish(SwarmEvent(
            event_type=EventType.QUALIFICATION_NEEDED,
            contact_id=phone_number,
            payload={},
            source_agent="coordinator",
        ))

    async def request_video(self, phone_number: str, script: Optional[str] = None) -> None:
        """Request video generation for a contact"""
        await self.eventbus.publish(SwarmEvent(
            event_type=EventType.VIDEO_REQUESTED,
            contact_id=phone_number,
            payload={"script": script} if script else {},
            source_agent="coordinator",
        ))

    async def request_voice(self, phone_number: str, script: Optional[str] = None) -> None:
        """Request voice generation for a contact"""
        await self.eventbus.publish(SwarmEvent(
            event_type=EventType.VOICE_REQUESTED,
            contact_id=phone_number,
            payload={"script": script} if script else {},
            source_agent="coordinator",
        ))

    async def request_crm_sync(self, phone_number: str) -> None:
        """Request CRM sync for a contact"""
        await self.eventbus.publish(SwarmEvent(
            event_type=EventType.CRM_SYNC_NEEDED,
            contact_id=phone_number,
            payload={},
            source_agent="coordinator",
        ))

    def _detect_intent(self, message: str) -> str:
        """
        Detect the user's intent from their message.

        Returns a simple intent string for the payload.
        """
        message_lower = message.lower().strip()

        # Greeting patterns
        if re.search(r"^(hi|hello|hey|howdy|hola|greetings|good (morning|afternoon|evening))", message_lower):
            return "greeting"

        # Introduction patterns
        if re.search(r"(my name is|i'?m |i am |i work at|i'?m from)", message_lower):
            return "introduction"

        # Meeting request patterns
        if re.search(r"(let'?s|can we|want to|schedule|book).*(meet|chat|talk|call)", message_lower):
            return "meeting_request"

        # Contact info patterns
        if re.search(r"(my email|email me|reach me|@\w+\.\w+|linkedin\.com)", message_lower):
            return "contact_info"

        # Thanks patterns
        if re.search(r"^(thanks|thank you|thx|ty|appreciate)", message_lower):
            return "thank_you"

        # Goodbye patterns
        if re.search(r"^(bye|goodbye|see you|take care|later)", message_lower):
            return "goodbye"

        # Question patterns
        if re.search(r"\?$|^(what|who|where|when|why|how|can|do|does|is|are)", message_lower):
            return "question"

        return "general"

    def _extract_entities(self, message: str) -> dict:
        """
        Extract relevant entities from the message.
        """
        entities = {}

        # Email extraction
        email_match = re.search(r"[\w\.-]+@[\w\.-]+\.\w+", message)
        if email_match:
            entities["email"] = email_match.group()

        # LinkedIn URL
        linkedin_match = re.search(r"linkedin\.com/in/[\w\-]+", message.lower())
        if linkedin_match:
            entities["linkedin_url"] = f"https://www.{linkedin_match.group()}"

        # Name extraction
        name_patterns = [
            r"(?:my name is|i'?m|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
            r"(?:this is|it'?s)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
        ]
        for pattern in name_patterns:
            name_match = re.search(pattern, message, re.IGNORECASE)
            if name_match:
                full_name = name_match.group(1).strip()
                parts = full_name.split()
                entities["first_name"] = parts[0]
                if len(parts) > 1:
                    entities["last_name"] = " ".join(parts[1:])
                break

        # Company extraction
        company_patterns = [
            r"(?:i work at|i'?m (?:from|with)|at)\s+([A-Z][\w\s&]+?)(?:\.|,|$|\s+(?:as|and))",
            r"(?:company|organization|firm)(?:\s+is)?\s+([A-Z][\w\s&]+?)(?:\.|,|$)",
        ]
        for pattern in company_patterns:
            company_match = re.search(pattern, message, re.IGNORECASE)
            if company_match:
                entities["company_name"] = company_match.group(1).strip()
                break

        # Job title extraction
        title_patterns = [
            r"(?:i'?m a|i am a|work as a?|my role is)\s+([A-Za-z\s]+?)(?:\.|,|$|\s+at)",
        ]
        for pattern in title_patterns:
            title_match = re.search(pattern, message, re.IGNORECASE)
            if title_match:
                entities["job_title"] = title_match.group(1).strip()
                break

        return entities
