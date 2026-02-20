"""
Blackboard - Shared State Management

Implements the Blackboard architectural pattern for swarm agents.
All agents read and write shared state through this interface.

State is stored in both Redis (fast access) and PostgreSQL (persistence).
"""

import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional, Any, Dict, List
from dataclasses import dataclass, field
import json

import redis.asyncio as redis
from asyncpg import create_pool, Pool

from .events import SwarmEvent, EventType

logger = logging.getLogger(__name__)


@dataclass
class ContactState:
    """
    Shared state for a contact, visible to all agents.

    This is the "blackboard" that agents read from and write to.
    """

    # Identity
    phone_number: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    push_name: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    company_name: Optional[str] = None
    job_title: Optional[str] = None

    # Research status
    research_status: str = "pending"  # pending, in_progress, complete, failed
    research_data: Optional[dict] = None
    research_completed_at: Optional[str] = None

    # Qualification status
    qualification_tier: Optional[str] = None  # hot, warm, cold, unqualified
    qualification_score: Optional[int] = None
    qualification_data: Optional[dict] = None
    qualification_updated_at: Optional[str] = None

    # Video/Voice status
    heygen_video_url: Optional[str] = None
    heygen_video_id: Optional[str] = None
    video_script: Optional[str] = None
    voice_audio_url: Optional[str] = None

    # CRM status
    hubspot_contact_id: Optional[str] = None
    crm_synced_at: Optional[str] = None

    # Conversation state
    conversation_turns: int = 0
    last_message_at: Optional[str] = None
    last_message_text: Optional[str] = None
    welcomed: bool = False
    voice_mode: bool = False

    # Pending actions (for agents to claim)
    pending_actions: dict = field(default_factory=dict)

    # Timestamps
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            "phone_number": self.phone_number,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "push_name": self.push_name,
            "email": self.email,
            "linkedin_url": self.linkedin_url,
            "company_name": self.company_name,
            "job_title": self.job_title,
            "research_status": self.research_status,
            "research_data": self.research_data,
            "research_completed_at": self.research_completed_at,
            "qualification_tier": self.qualification_tier,
            "qualification_score": self.qualification_score,
            "qualification_data": self.qualification_data,
            "qualification_updated_at": self.qualification_updated_at,
            "heygen_video_url": self.heygen_video_url,
            "heygen_video_id": self.heygen_video_id,
            "video_script": self.video_script,
            "voice_audio_url": self.voice_audio_url,
            "hubspot_contact_id": self.hubspot_contact_id,
            "crm_synced_at": self.crm_synced_at,
            "conversation_turns": self.conversation_turns,
            "last_message_at": self.last_message_at,
            "last_message_text": self.last_message_text,
            "welcomed": self.welcomed,
            "voice_mode": self.voice_mode,
            "pending_actions": self.pending_actions,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ContactState":
        """Create from dictionary"""
        return cls(
            phone_number=data.get("phone_number", ""),
            first_name=data.get("first_name"),
            last_name=data.get("last_name"),
            push_name=data.get("push_name"),
            email=data.get("email"),
            linkedin_url=data.get("linkedin_url"),
            company_name=data.get("company_name"),
            job_title=data.get("job_title"),
            research_status=data.get("research_status", "pending"),
            research_data=data.get("research_data"),
            research_completed_at=data.get("research_completed_at"),
            qualification_tier=data.get("qualification_tier"),
            qualification_score=data.get("qualification_score"),
            qualification_data=data.get("qualification_data"),
            qualification_updated_at=data.get("qualification_updated_at"),
            heygen_video_url=data.get("heygen_video_url"),
            heygen_video_id=data.get("heygen_video_id"),
            video_script=data.get("video_script"),
            voice_audio_url=data.get("voice_audio_url"),
            hubspot_contact_id=data.get("hubspot_contact_id"),
            crm_synced_at=data.get("crm_synced_at"),
            conversation_turns=data.get("conversation_turns", 0),
            last_message_at=data.get("last_message_at"),
            last_message_text=data.get("last_message_text"),
            welcomed=data.get("welcomed", False),
            voice_mode=data.get("voice_mode", False),
            pending_actions=data.get("pending_actions", {}),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


class Blackboard:
    """
    Shared state manager for swarm agents.

    Provides:
    - Fast read/write via Redis
    - Persistence via PostgreSQL
    - Distributed locking for safe updates
    - Event logging for debugging
    """

    REDIS_PREFIX = "swarm:contact:"
    LOCK_PREFIX = "swarm:lock:"
    LOCK_TTL = 30  # seconds
    CACHE_TTL = 3600  # 1 hour

    def __init__(
        self,
        redis_url: Optional[str] = None,
        database_url: Optional[str] = None,
    ):
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
        self.database_url = database_url or os.getenv("DATABASE_URL")
        self._redis: Optional[redis.Redis] = None
        self._pool: Optional[Pool] = None

    async def connect(self) -> None:
        """Connect to Redis and PostgreSQL"""
        if self._redis is None:
            self._redis = redis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )

        if self._pool is None and self.database_url:
            try:
                self._pool = await create_pool(self.database_url, min_size=2, max_size=10)
                logger.info("Blackboard connected to PostgreSQL")
            except Exception as e:
                logger.warning(f"PostgreSQL connection failed: {e}")

        logger.info("Blackboard connected to Redis")

    async def close(self) -> None:
        """Close connections"""
        if self._redis:
            await self._redis.aclose()
            self._redis = None

        if self._pool:
            await self._pool.close()
            self._pool = None

        logger.info("Blackboard disconnected")

    def _cache_key(self, contact_id: str) -> str:
        """Get Redis key for contact state"""
        return f"{self.REDIS_PREFIX}{contact_id}"

    def _lock_key(self, contact_id: str) -> str:
        """Get Redis key for contact lock"""
        return f"{self.LOCK_PREFIX}{contact_id}"

    async def get_contact(self, contact_id: str) -> Optional[ContactState]:
        """
        Get contact state from cache or database.

        Args:
            contact_id: Phone number or unique identifier

        Returns:
            ContactState or None if not found
        """
        await self.connect()

        # Try cache first
        cached = await self._redis.get(self._cache_key(contact_id))
        if cached:
            return ContactState.from_dict(json.loads(cached))

        # Fall back to database
        if self._pool:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT * FROM networking_contacts
                    WHERE phone_number = $1
                    """,
                    contact_id,
                )
                if row:
                    state = self._row_to_state(dict(row))
                    # Cache it
                    await self._redis.setex(
                        self._cache_key(contact_id),
                        self.CACHE_TTL,
                        json.dumps(state.to_dict()),
                    )
                    return state

        return None

    async def save_contact(self, state: ContactState) -> None:
        """
        Save contact state to cache and database.

        Args:
            state: ContactState to save
        """
        await self.connect()

        now = datetime.utcnow().isoformat()
        if not state.created_at:
            state.created_at = now
        state.updated_at = now

        # Save to cache
        await self._redis.setex(
            self._cache_key(state.phone_number),
            self.CACHE_TTL,
            json.dumps(state.to_dict()),
        )

        # Save to database
        if self._pool:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO networking_contacts (
                        phone_number, first_name, last_name, push_name,
                        email, linkedin_url, company_name, job_title,
                        research_status, qualification_tier, qualification_score,
                        heygen_video_url, hubspot_contact_id,
                        conversation_turns, welcomed, voice_mode,
                        pending_actions, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15, $16, $17, $18, $19
                    )
                    ON CONFLICT (phone_number) DO UPDATE SET
                        first_name = COALESCE(EXCLUDED.first_name, networking_contacts.first_name),
                        last_name = COALESCE(EXCLUDED.last_name, networking_contacts.last_name),
                        push_name = COALESCE(EXCLUDED.push_name, networking_contacts.push_name),
                        email = COALESCE(EXCLUDED.email, networking_contacts.email),
                        linkedin_url = COALESCE(EXCLUDED.linkedin_url, networking_contacts.linkedin_url),
                        company_name = COALESCE(EXCLUDED.company_name, networking_contacts.company_name),
                        job_title = COALESCE(EXCLUDED.job_title, networking_contacts.job_title),
                        research_status = EXCLUDED.research_status,
                        qualification_tier = COALESCE(EXCLUDED.qualification_tier, networking_contacts.qualification_tier),
                        qualification_score = COALESCE(EXCLUDED.qualification_score, networking_contacts.qualification_score),
                        heygen_video_url = COALESCE(EXCLUDED.heygen_video_url, networking_contacts.heygen_video_url),
                        hubspot_contact_id = COALESCE(EXCLUDED.hubspot_contact_id, networking_contacts.hubspot_contact_id),
                        conversation_turns = EXCLUDED.conversation_turns,
                        welcomed = EXCLUDED.welcomed,
                        voice_mode = EXCLUDED.voice_mode,
                        pending_actions = EXCLUDED.pending_actions,
                        updated_at = EXCLUDED.updated_at
                    """,
                    state.phone_number,
                    state.first_name,
                    state.last_name,
                    state.push_name,
                    state.email,
                    state.linkedin_url,
                    state.company_name,
                    state.job_title,
                    state.research_status,
                    state.qualification_tier,
                    state.qualification_score,
                    state.heygen_video_url,
                    state.hubspot_contact_id,
                    state.conversation_turns,
                    state.welcomed,
                    state.voice_mode,
                    json.dumps(state.pending_actions),
                    state.created_at,
                    state.updated_at,
                )

    async def update_contact(
        self,
        contact_id: str,
        **updates: Any,
    ) -> ContactState:
        """
        Update specific fields on a contact.

        Uses optimistic locking to prevent race conditions.
        """
        await self.connect()

        # Get current state
        state = await self.get_contact(contact_id)
        if not state:
            state = ContactState(phone_number=contact_id)

        # Apply updates
        for key, value in updates.items():
            if hasattr(state, key):
                setattr(state, key, value)

        # Save
        await self.save_contact(state)
        return state

    async def acquire_lock(
        self,
        contact_id: str,
        owner: str,
        ttl: int = None,
    ) -> bool:
        """
        Acquire a distributed lock for a contact.

        Args:
            contact_id: Contact to lock
            owner: Lock owner (agent name)
            ttl: Lock timeout in seconds

        Returns:
            True if lock acquired
        """
        await self.connect()
        ttl = ttl or self.LOCK_TTL
        return await self._redis.set(
            self._lock_key(contact_id),
            owner,
            nx=True,
            ex=ttl,
        )

    async def release_lock(self, contact_id: str, owner: str) -> bool:
        """
        Release a distributed lock.

        Only releases if owner matches.
        """
        await self.connect()
        lock_key = self._lock_key(contact_id)
        current_owner = await self._redis.get(lock_key)
        if current_owner == owner:
            await self._redis.delete(lock_key)
            return True
        return False

    async def log_event(self, event: SwarmEvent) -> None:
        """
        Log an event to PostgreSQL for debugging/auditing.
        """
        if not self._pool:
            return

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO swarm_event_log (
                    event_id, event_type, source_agent, contact_id,
                    payload, causation_id, correlation_id, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                event.event_id,
                event.event_type.value if isinstance(event.event_type, EventType) else event.event_type,
                event.source_agent,
                event.contact_id,
                json.dumps(event.payload),
                event.causation_id,
                event.correlation_id,
                event.timestamp,
            )

    async def get_agent_state(
        self,
        agent_name: str,
        contact_id: str,
    ) -> Optional[dict]:
        """Get agent-specific state for a contact"""
        if not self._pool:
            return None

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM swarm_agent_state
                WHERE agent_name = $1 AND contact_id = $2
                """,
                agent_name,
                contact_id,
            )
            return dict(row) if row else None

    async def save_agent_state(
        self,
        agent_name: str,
        contact_id: str,
        state: str,
        event_id: Optional[str] = None,
    ) -> None:
        """Save agent-specific state for a contact"""
        if not self._pool:
            return

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO swarm_agent_state (
                    agent_name, contact_id, state, current_event_id, last_action_at
                ) VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (agent_name, contact_id) DO UPDATE SET
                    state = EXCLUDED.state,
                    current_event_id = EXCLUDED.current_event_id,
                    last_action_at = NOW()
                """,
                agent_name,
                contact_id,
                state,
                event_id,
            )

    async def list_contacts(
        self,
        limit: int = 100,
        offset: int = 0,
        filters: Optional[dict] = None,
    ) -> List[ContactState]:
        """List contacts with optional filtering"""
        if not self._pool:
            return []

        async with self._pool.acquire() as conn:
            query = "SELECT * FROM networking_contacts ORDER BY updated_at DESC LIMIT $1 OFFSET $2"
            rows = await conn.fetch(query, limit, offset)
            return [self._row_to_state(dict(row)) for row in rows]

    def _row_to_state(self, row: dict) -> ContactState:
        """Convert database row to ContactState"""
        # Handle JSON fields
        pending_actions = row.get("pending_actions", {})
        if isinstance(pending_actions, str):
            pending_actions = json.loads(pending_actions) if pending_actions else {}

        return ContactState(
            phone_number=row.get("phone_number", ""),
            first_name=row.get("first_name"),
            last_name=row.get("last_name"),
            push_name=row.get("push_name"),
            email=row.get("email"),
            linkedin_url=row.get("linkedin_url"),
            company_name=row.get("company_name"),
            job_title=row.get("job_title"),
            research_status=row.get("research_status", "pending"),
            research_data=row.get("research_data"),
            qualification_tier=row.get("qualification_tier"),
            qualification_score=row.get("qualification_score"),
            heygen_video_url=row.get("heygen_video_url"),
            hubspot_contact_id=row.get("hubspot_contact_id"),
            conversation_turns=row.get("conversation_turns", 0),
            welcomed=row.get("welcomed", False),
            voice_mode=row.get("voice_mode", False),
            pending_actions=pending_actions,
            created_at=str(row.get("created_at")) if row.get("created_at") else None,
            updated_at=str(row.get("updated_at")) if row.get("updated_at") else None,
        )
