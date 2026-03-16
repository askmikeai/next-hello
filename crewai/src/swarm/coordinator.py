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

        if self.is_erasure_request(message_text):
            await self.blackboard.delete_contact_data(phone_number)
            return (
                "Understood. I deleted your stored information from this system now. "
                "If you message again later, we will treat it as a new conversation."
            )

        # Get or create contact state
        contact = await self.blackboard.get_contact(phone_number)
        is_new_contact = contact is None

        inferred_name = self._extract_name_from_push_name(push_name)

        if is_new_contact:
            contact = ContactState(
                phone_number=phone_number,
                push_name=push_name,
                first_name=inferred_name.get("first_name"),
                last_name=inferred_name.get("last_name"),
            )
            await self.blackboard.save_contact(contact)

            # Publish contact.created event
            await self.eventbus.publish(
                SwarmEvent(
                    event_type=EventType.CONTACT_CREATED,
                    contact_id=phone_number,
                    payload={
                        "push_name": push_name,
                        "source": "whatsapp",
                    },
                    source_agent="coordinator",
                )
            )

        # If contact is already connected on LinkedIn via OpenClaw, ignore inbound automation.
        if contact.open_claw_linkedin_connected:
            logger.info(
                "Skipping swarm automation for LinkedIn-connected contact",
                extra={"phone_number": phone_number},
            )
            return None

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

        # If profile name exists but contact name is missing, infer from push_name.
        if push_name and not contact.first_name and not contact.last_name:
            if inferred_name.get("first_name"):
                updated_fields["first_name"] = inferred_name["first_name"]
            if inferred_name.get("last_name"):
                updated_fields["last_name"] = inferred_name["last_name"]

        # Increment conversation turns
        updated_fields["conversation_turns"] = contact.conversation_turns + 1
        updated_fields["last_message_at"] = datetime.utcnow().isoformat()
        updated_fields["last_message_text"] = message_text[:500]

        # Voice preference rules:
        # - Audio input enables voice mode by default.
        # - Explicit text-only instruction disables voice mode.
        if self._wants_text_only(message_text):
            updated_fields["voice_mode"] = False
        elif message_type == "audio" and not contact.voice_mode:
            updated_fields["voice_mode"] = True

        if updated_fields:
            contact = await self.blackboard.update_contact(phone_number, **updated_fields)

            # If contact info changed, publish update event
            if any(
                k in updated_fields for k in ["email", "linkedin_url", "first_name", "company_name"]
            ):
                await self.eventbus.publish(
                    SwarmEvent(
                        event_type=EventType.CONTACT_UPDATED,
                        contact_id=phone_number,
                        payload={
                            "updated_fields": list(updated_fields.keys()),
                            "entities": entities,
                        },
                        source_agent="coordinator",
                    )
                )

        # Detect intent
        intent = self._detect_intent(message_text)

        # Publish message.received event
        await self.eventbus.publish(
            SwarmEvent(
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
            )
        )

        # Demo mode behavior: attempt one welcome video for every contact.
        # VideoAgent safely ignores duplicates and failures are non-blocking.
        if not contact.heygen_video_url and not contact.heygen_video_id:
            name = contact.first_name or inferred_name.get("first_name") or push_name or "there"
            owner_name = os.getenv("OWNER_NAME", "Michael Friedberg")
            event_name = os.getenv("EVENT_NAME", "Open Claw Demos, Agent Swarms and workflows")
            demo_video_script = (
                f"Hey {name}, nice to meet you at {event_name}. "
                f"I am {owner_name}'s assistant and I am glad we connected. "
                "Looking forward to learning more about what you are building and how we can help."
            )
            await self.eventbus.publish(
                SwarmEvent(
                    event_type=EventType.VIDEO_REQUESTED,
                    contact_id=phone_number,
                    payload={
                        "script": demo_video_script,
                        "welcome_video": True,
                        "source": "demo-all-contacts",
                    },
                    source_agent="coordinator",
                )
            )

        # Generate immediate response for new contacts
        # The Personalization Agent will handle actual responses via message.send
        if is_new_contact and not contact.welcomed:
            await self.blackboard.update_contact(phone_number, welcomed=True)
            name = contact.first_name or inferred_name.get("first_name") or push_name or "there"
            owner_name = os.getenv("OWNER_NAME", "Michael Friedberg")
            event_name = os.getenv("EVENT_NAME", "Open Claw Demos, Agent Swarms and workflows")
            welcome_text = (
                f"Hey {name}! Nice to meet you at {event_name}. "
                f"I'm {owner_name}'s assistant and excited to connect. "
                "I will send you a quick welcome video shortly."
            )

            await self.eventbus.publish(
                SwarmEvent(
                    event_type=EventType.RESEARCH_NEEDED,
                    contact_id=phone_number,
                    payload={"source": "new_contact"},
                    source_agent="coordinator",
                )
            )

            # If they reached out by voice, send a voice version of the welcome too
            # unless they explicitly requested text-only responses.
            if message_type == "audio" and not self._wants_text_only(message_text):
                await self.eventbus.publish(
                    SwarmEvent(
                        event_type=EventType.VOICE_REQUESTED,
                        contact_id=phone_number,
                        payload={"script": welcome_text},
                        source_agent="coordinator",
                    )
                )

            return welcome_text

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
        await self.eventbus.publish(
            SwarmEvent(
                event_type=EventType.MESSAGE_SEND,
                contact_id=phone_number,
                payload={
                    "text": text,
                    "message_type": message_type,
                    "media_url": media_url,
                },
                source_agent="coordinator",
            )
        )

    async def request_research(self, phone_number: str) -> None:
        """Request research for a contact"""
        await self.eventbus.publish(
            SwarmEvent(
                event_type=EventType.RESEARCH_NEEDED,
                contact_id=phone_number,
                payload={},
                source_agent="coordinator",
            )
        )

    async def request_qualification(self, phone_number: str) -> None:
        """Request qualification for a contact"""
        await self.eventbus.publish(
            SwarmEvent(
                event_type=EventType.QUALIFICATION_NEEDED,
                contact_id=phone_number,
                payload={},
                source_agent="coordinator",
            )
        )

    async def request_video(self, phone_number: str, script: Optional[str] = None) -> None:
        """Request video generation for a contact"""
        await self.eventbus.publish(
            SwarmEvent(
                event_type=EventType.VIDEO_REQUESTED,
                contact_id=phone_number,
                payload={"script": script} if script else {},
                source_agent="coordinator",
            )
        )

    async def request_voice(self, phone_number: str, script: Optional[str] = None) -> None:
        """Request voice generation for a contact"""
        await self.eventbus.publish(
            SwarmEvent(
                event_type=EventType.VOICE_REQUESTED,
                contact_id=phone_number,
                payload={"script": script} if script else {},
                source_agent="coordinator",
            )
        )

    async def request_crm_sync(self, phone_number: str) -> None:
        """Request CRM sync for a contact"""
        await self.eventbus.publish(
            SwarmEvent(
                event_type=EventType.CRM_SYNC_NEEDED,
                contact_id=phone_number,
                payload={},
                source_agent="coordinator",
            )
        )

    def _detect_intent(self, message: str) -> str:
        """
        Detect the user's intent from their message.

        Returns a simple intent string for the payload.
        """
        message_lower = message.lower().strip()

        # Greeting patterns
        if re.search(
            r"^(hi|hello|hey|howdy|hola|greetings|good (morning|afternoon|evening))", message_lower
        ):
            return "greeting"

        # Introduction patterns
        if re.search(r"(my name is|i'?m |i am |i work at|i'?m from)", message_lower):
            return "introduction"

        # Meeting request patterns
        if re.search(
            r"(let'?s|can we|want to|schedule|book).*(meet|chat|talk|call)", message_lower
        ):
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

    def _wants_text_only(self, message: str) -> bool:
        """Detect explicit instruction to avoid voice replies."""
        message_lower = message.lower().strip()
        patterns = [
            r"\btext only\b",
            r"\bno voice\b",
            r"\bdon'?t (send|use) voice\b",
            r"\bdo not (send|use) voice\b",
            r"\bstop (sending )?voice\b",
            r"\bvoice off\b",
        ]
        return any(re.search(pattern, message_lower) for pattern in patterns)

    def is_erasure_request(self, message: str) -> bool:
        """Detect requests to delete personal data immediately."""
        message_lower = message.lower().strip()
        patterns = [
            r"\bdelete\s+(my\s+)?(data|information|info|details|profile)\b",
            r"\bremove\s+(my\s+)?(data|information|info|details|profile)\b",
            r"\berase\s+(my\s+)?(data|information|info|details|profile)\b",
            r"\bdelete\s+me\b",
            r"\bremove\s+me\b",
            r"\bforget\s+me\b",
            r"\bright\s+to\s+be\s+forgotten\b",
        ]
        return any(re.search(pattern, message_lower) for pattern in patterns)

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
            r"(?:this is|i'?m|i am)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+from\s+([A-Z][\w\s&]+?)(?:\.|,|$|\s+(?:as|and))",
            r"from\s+([A-Z][\w\s&]+?)(?:\.|,|$|\s+(?:as|and))",
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

    def _extract_name_from_push_name(self, push_name: Optional[str]) -> dict:
        """Best-effort first/last name parsing from WhatsApp push_name."""
        if not push_name:
            return {}

        cleaned = re.sub(r"\s+", " ", str(push_name)).strip()
        if not cleaned or any(ch.isdigit() for ch in cleaned):
            return {}

        parts = cleaned.split(" ")
        if not parts:
            return {}

        if len(parts) == 1:
            return {"first_name": parts[0]}

        return {
            "first_name": parts[0],
            "last_name": " ".join(parts[1:]),
        }
