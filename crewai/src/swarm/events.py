"""
Swarm Event Definitions

Event types and schemas for the swarm event bus.
All agents communicate via these standardized events.
"""

from enum import Enum
from typing import Optional, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime
import uuid
import json


class EventType(str, Enum):
    """All event types in the swarm system"""

    # Contact Events
    CONTACT_CREATED = "contact.created"
    CONTACT_UPDATED = "contact.updated"
    CONTACT_FIELDS_COMPLETE = "contact.fields_complete"

    # Message Events
    MESSAGE_RECEIVED = "message.received"
    MESSAGE_SEND = "message.send"
    MESSAGE_SENT = "message.sent"

    # Research Events
    RESEARCH_NEEDED = "research.needed"
    RESEARCH_COMPLETED = "research.completed"
    RESEARCH_FAILED = "research.failed"

    # Qualification Events
    QUALIFICATION_NEEDED = "qualification.needed"
    QUALIFICATION_COMPLETED = "qualification.completed"

    # Video Events
    VIDEO_REQUESTED = "video.requested"
    VIDEO_SCRIPT_READY = "video.script_ready"
    VIDEO_STARTED = "video.started"
    VIDEO_COMPLETED = "video.completed"

    # Voice Events
    VOICE_REQUESTED = "voice.requested"
    VOICE_COMPLETED = "voice.completed"

    # CRM Events
    CRM_SYNC_NEEDED = "crm.sync_needed"
    CRM_SYNCED = "crm.synced"


@dataclass
class SwarmEvent:
    """
    Base event class for all swarm events.

    Attributes:
        event_type: The type of event
        contact_id: Phone number or unique contact identifier
        payload: Event-specific data
        source_agent: Agent that published this event
        event_id: Unique identifier for this event
        correlation_id: ID linking related events in a flow
        causation_id: ID of the event that caused this one
        timestamp: When the event was created
    """

    event_type: EventType
    contact_id: str
    payload: dict = field(default_factory=dict)
    source_agent: str = "system"
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    correlation_id: str = ""
    causation_id: Optional[str] = None
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def __post_init__(self):
        """Set correlation_id to event_id if not provided"""
        if not self.correlation_id:
            self.correlation_id = self.event_id

    def to_dict(self) -> dict:
        """Convert event to dictionary for serialization"""
        return {
            "event_type": self.event_type.value if isinstance(self.event_type, EventType) else self.event_type,
            "contact_id": self.contact_id,
            "payload": self.payload,
            "source_agent": self.source_agent,
            "event_id": self.event_id,
            "correlation_id": self.correlation_id,
            "causation_id": self.causation_id,
            "timestamp": self.timestamp,
        }

    def to_json(self) -> str:
        """Serialize event to JSON string"""
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: dict) -> "SwarmEvent":
        """Create event from dictionary"""
        event_type = data.get("event_type", "")
        if isinstance(event_type, str):
            try:
                event_type = EventType(event_type)
            except ValueError:
                pass  # Keep as string if not a valid EventType

        return cls(
            event_type=event_type,
            contact_id=data.get("contact_id", ""),
            payload=data.get("payload", {}),
            source_agent=data.get("source_agent", "system"),
            event_id=data.get("event_id", str(uuid.uuid4())),
            correlation_id=data.get("correlation_id", ""),
            causation_id=data.get("causation_id"),
            timestamp=data.get("timestamp", datetime.utcnow().isoformat()),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "SwarmEvent":
        """Create event from JSON string"""
        return cls.from_dict(json.loads(json_str))

    def create_response(
        self,
        event_type: EventType,
        payload: dict,
        source_agent: str,
    ) -> "SwarmEvent":
        """
        Create a response event that maintains causation chain.

        Args:
            event_type: Type of the new event
            payload: Data for the new event
            source_agent: Agent creating the response

        Returns:
            New SwarmEvent with proper causation/correlation
        """
        return SwarmEvent(
            event_type=event_type,
            contact_id=self.contact_id,
            payload=payload,
            source_agent=source_agent,
            correlation_id=self.correlation_id,  # Maintain correlation
            causation_id=self.event_id,  # This event caused the new one
        )


# Event stream names for Redis Streams
STREAM_NAMES = {
    "contact": "swarm:events:contact",
    "message": "swarm:events:message",
    "research": "swarm:events:research",
    "qualification": "swarm:events:qualification",
    "video": "swarm:events:video",
    "voice": "swarm:events:voice",
    "crm": "swarm:events:crm",
}


def get_stream_for_event(event_type: EventType) -> str:
    """Get the Redis stream name for an event type"""
    prefix = event_type.value.split(".")[0]
    return STREAM_NAMES.get(prefix, "swarm:events:default")
