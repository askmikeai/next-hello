"""
Redis State Manager

Manages conversation state and contact data in Redis.
"""

import os
import json
from datetime import datetime, timedelta
from typing import Optional, Any
from pydantic import BaseModel, Field
import redis.asyncio as redis


class ConversationState(BaseModel):
    """State for a conversation with a contact"""

    phone_number: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    push_name: Optional[str] = None
    email: Optional[str] = None
    linkedin_url: Optional[str] = None
    company_name: Optional[str] = None
    job_title: Optional[str] = None

    # Enrichment data
    research_data: Optional[dict] = None
    qualification_data: Optional[dict] = None

    # Conversation tracking
    conversation_turns: int = 0
    last_message_at: Optional[str] = None
    last_message_id: Optional[str] = None
    last_message_text: Optional[str] = None

    # Status flags
    has_meeting: bool = False
    calendly_sent: bool = False
    video_sent: bool = False
    voice_sent: bool = False
    crm_synced: bool = False

    # Message history (last N messages)
    message_history: list[dict] = Field(default_factory=list)

    # Agent task results
    recent_agent_results: dict = Field(default_factory=dict)

    # Timestamps
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class RedisStateManager:
    """
    Manages conversation state in Redis.

    Key patterns:
    - state:{phone_number} - Conversation state
    - history:{phone_number} - Full message history
    - lock:{phone_number} - Distributed lock for concurrent access
    """

    STATE_PREFIX = "state:"
    HISTORY_PREFIX = "history:"
    LOCK_PREFIX = "lock:"
    STATE_TTL = 60 * 60 * 24 * 30  # 30 days
    HISTORY_TTL = 60 * 60 * 24 * 90  # 90 days
    MAX_HISTORY_IN_STATE = 20  # Keep last 20 messages in state

    def __init__(self, redis_url: Optional[str] = None):
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
        self._redis: Optional[redis.Redis] = None

    async def connect(self):
        """Connect to Redis"""
        if self._redis is None:
            self._redis = redis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )

    async def close(self):
        """Close Redis connection"""
        if self._redis:
            await self._redis.aclose()
            self._redis = None

    def _state_key(self, phone_number: str) -> str:
        return f"{self.STATE_PREFIX}{phone_number}"

    def _history_key(self, phone_number: str) -> str:
        return f"{self.HISTORY_PREFIX}{phone_number}"

    def _lock_key(self, phone_number: str) -> str:
        return f"{self.LOCK_PREFIX}{phone_number}"

    async def get_state(self, phone_number: str) -> Optional[ConversationState]:
        """
        Get conversation state for a phone number.

        Args:
            phone_number: The contact's phone number

        Returns:
            ConversationState or None if not found
        """
        await self.connect()
        data = await self._redis.get(self._state_key(phone_number))
        if data:
            return ConversationState(**json.loads(data))
        return None

    async def save_state(self, state: ConversationState) -> None:
        """
        Save conversation state.

        Args:
            state: The conversation state to save
        """
        await self.connect()
        state.updated_at = datetime.utcnow().isoformat()
        if not state.created_at:
            state.created_at = state.updated_at

        await self._redis.setex(
            self._state_key(state.phone_number),
            self.STATE_TTL,
            state.model_dump_json(),
        )

    async def update_state(
        self,
        phone_number: str,
        **updates: Any,
    ) -> ConversationState:
        """
        Update specific fields in conversation state.

        Args:
            phone_number: The contact's phone number
            **updates: Fields to update

        Returns:
            Updated ConversationState
        """
        state = await self.get_state(phone_number)
        if not state:
            state = ConversationState(phone_number=phone_number)

        for key, value in updates.items():
            if hasattr(state, key):
                setattr(state, key, value)

        await self.save_state(state)
        return state

    async def delete_state(self, phone_number: str) -> bool:
        """
        Delete conversation state.

        Args:
            phone_number: The contact's phone number

        Returns:
            True if deleted, False if not found
        """
        await self.connect()
        result = await self._redis.delete(self._state_key(phone_number))
        return result > 0

    async def add_message(
        self,
        phone_number: str,
        message_id: str,
        direction: str,  # "incoming" or "outgoing"
        message_type: str,
        content: str,
        media_url: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> None:
        """
        Add a message to the conversation history.

        Args:
            phone_number: The contact's phone number
            message_id: WhatsApp message ID
            direction: "incoming" or "outgoing"
            message_type: Type of message (text, image, audio, etc.)
            content: Message content or caption
            media_url: URL of media if applicable
            metadata: Additional metadata
        """
        await self.connect()

        message = {
            "id": message_id,
            "direction": direction,
            "type": message_type,
            "content": content,
            "media_url": media_url,
            "metadata": metadata or {},
            "timestamp": datetime.utcnow().isoformat(),
        }

        # Add to full history (Redis list)
        history_key = self._history_key(phone_number)
        await self._redis.lpush(history_key, json.dumps(message))
        await self._redis.expire(history_key, self.HISTORY_TTL)

        # Update state with recent messages
        state = await self.get_state(phone_number)
        if not state:
            state = ConversationState(phone_number=phone_number)

        # Add to state's message history (keep last N)
        state.message_history.insert(0, message)
        state.message_history = state.message_history[: self.MAX_HISTORY_IN_STATE]

        # Update conversation tracking
        if direction == "incoming":
            state.conversation_turns += 1
        state.last_message_at = message["timestamp"]
        state.last_message_id = message_id
        state.last_message_text = content

        await self.save_state(state)

    async def get_message_history(
        self,
        phone_number: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """
        Get full message history.

        Args:
            phone_number: The contact's phone number
            limit: Maximum number of messages
            offset: Number of messages to skip

        Returns:
            List of messages (newest first)
        """
        await self.connect()
        history_key = self._history_key(phone_number)
        messages = await self._redis.lrange(history_key, offset, offset + limit - 1)
        return [json.loads(m) for m in messages]

    async def set_agent_result(
        self,
        phone_number: str,
        agent_type: str,
        result: Any,
        ttl: int = 3600,
    ) -> None:
        """
        Store result from an agent execution.

        Args:
            phone_number: The contact's phone number
            agent_type: Type of agent (research, qualification, etc.)
            result: Result data
            ttl: Time to live in seconds
        """
        state = await self.get_state(phone_number)
        if not state:
            state = ConversationState(phone_number=phone_number)

        state.recent_agent_results[agent_type] = {
            "result": result,
            "timestamp": datetime.utcnow().isoformat(),
            "expires_at": (datetime.utcnow() + timedelta(seconds=ttl)).isoformat(),
        }

        await self.save_state(state)

    async def get_agent_result(
        self,
        phone_number: str,
        agent_type: str,
    ) -> Optional[Any]:
        """
        Get result from a previous agent execution.

        Args:
            phone_number: The contact's phone number
            agent_type: Type of agent

        Returns:
            Agent result or None if not found/expired
        """
        state = await self.get_state(phone_number)
        if not state:
            return None

        result_data = state.recent_agent_results.get(agent_type)
        if not result_data:
            return None

        # Check expiration
        expires_at = datetime.fromisoformat(result_data["expires_at"])
        if datetime.utcnow() > expires_at:
            return None

        return result_data["result"]

    async def acquire_lock(
        self,
        phone_number: str,
        timeout: int = 30,
    ) -> bool:
        """
        Acquire a distributed lock for a conversation.

        Args:
            phone_number: The contact's phone number
            timeout: Lock timeout in seconds

        Returns:
            True if lock acquired, False otherwise
        """
        await self.connect()
        lock_key = self._lock_key(phone_number)
        return await self._redis.set(lock_key, "1", nx=True, ex=timeout)

    async def release_lock(self, phone_number: str) -> None:
        """
        Release a distributed lock.

        Args:
            phone_number: The contact's phone number
        """
        await self.connect()
        await self._redis.delete(self._lock_key(phone_number))

    async def list_active_conversations(
        self,
        limit: int = 100,
    ) -> list[str]:
        """
        List phone numbers with active conversations.

        Args:
            limit: Maximum number to return

        Returns:
            List of phone numbers
        """
        await self.connect()
        cursor = 0
        phone_numbers = []

        while len(phone_numbers) < limit:
            cursor, keys = await self._redis.scan(
                cursor,
                match=f"{self.STATE_PREFIX}*",
                count=100,
            )
            for key in keys:
                phone = key.replace(self.STATE_PREFIX, "")
                phone_numbers.append(phone)
                if len(phone_numbers) >= limit:
                    break
            if cursor == 0:
                break

        return phone_numbers
