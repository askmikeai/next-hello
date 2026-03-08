"""
Event Bus - Redis Streams Implementation

Provides reliable pub/sub messaging for swarm agents using Redis Streams.
Features:
- Consumer groups for parallel processing
- Message acknowledgment and retry
- Event persistence and replay
- Automatic stream creation
"""

import os
import asyncio
import logging
from typing import Optional, Callable, Awaitable, List, Dict, Any
from dataclasses import dataclass
import redis.asyncio as redis

from .events import SwarmEvent, EventType, STREAM_NAMES, get_stream_for_event

logger = logging.getLogger(__name__)


@dataclass
class StreamMessage:
    """A message from a Redis Stream"""

    message_id: str
    stream: str
    event: SwarmEvent


class EventBus:
    """
    Redis Streams-based event bus for swarm communication.

    Each agent creates a consumer in a consumer group to process
    events. Messages are acknowledged after successful processing.

    Key patterns:
    - swarm:events:{category} - Event streams (contact, message, etc.)
    - swarm:consumers:{agent_name} - Consumer group tracking
    """

    # Max entries per stream (older entries are trimmed)
    MAX_STREAM_LENGTH = 10000

    # How long to block waiting for messages
    BLOCK_MS = 5000  # 5 seconds

    # Max messages to read at once
    READ_COUNT = 10

    def __init__(self, redis_url: Optional[str] = None):
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://localhost:6379")
        self._redis: Optional[redis.Redis] = None
        self._running = False
        self._consumer_tasks: Dict[str, asyncio.Task] = {}

    async def connect(self) -> None:
        """Connect to Redis"""
        if self._redis is None:
            self._redis = redis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
            logger.info("EventBus connected to Redis")

    async def close(self) -> None:
        """Close Redis connection and stop consumers"""
        self._running = False

        # Cancel consumer tasks
        for task in self._consumer_tasks.values():
            task.cancel()

        # Wait for tasks to complete
        if self._consumer_tasks:
            await asyncio.gather(*self._consumer_tasks.values(), return_exceptions=True)
            self._consumer_tasks.clear()

        if self._redis:
            await self._redis.aclose()
            self._redis = None
            logger.info("EventBus disconnected from Redis")

    async def _ensure_stream_exists(self, stream: str) -> None:
        """Create stream if it doesn't exist"""
        try:
            await self._redis.xinfo_stream(stream)
        except redis.ResponseError:
            # Stream doesn't exist, create it with a placeholder message
            await self._redis.xadd(
                stream,
                {"_init": "1"},
                maxlen=self.MAX_STREAM_LENGTH,
            )
            logger.info(f"Created stream: {stream}")

    async def _ensure_consumer_group(
        self,
        stream: str,
        group: str,
        start_id: str = "0",
    ) -> None:
        """Create consumer group if it doesn't exist"""
        await self._ensure_stream_exists(stream)
        try:
            await self._redis.xgroup_create(
                stream,
                group,
                id=start_id,
                mkstream=True,
            )
            logger.info(f"Created consumer group: {group} on {stream}")
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise

    async def publish(self, event: SwarmEvent) -> str:
        """
        Publish an event to the appropriate stream.

        Args:
            event: The event to publish

        Returns:
            The stream message ID
        """
        await self.connect()

        stream = get_stream_for_event(event.event_type)
        await self._ensure_stream_exists(stream)

        # Add event to stream
        message_id = await self._redis.xadd(
            stream,
            {"data": event.to_json()},
            maxlen=self.MAX_STREAM_LENGTH,
        )

        logger.debug(
            f"Published {event.event_type.value} to {stream} "
            f"[event_id={event.event_id}, stream_id={message_id}]"
        )

        return message_id

    async def publish_batch(self, events: List[SwarmEvent]) -> List[str]:
        """Publish multiple events"""
        return [await self.publish(event) for event in events]

    async def subscribe(
        self,
        streams: List[str],
        consumer_group: str,
        consumer_name: str,
        handler: Callable[[SwarmEvent], Awaitable[bool]],
        event_types: Optional[List[EventType]] = None,
    ) -> None:
        """
        Subscribe to events on specified streams.

        Args:
            streams: List of stream names to subscribe to
            consumer_group: Consumer group name (usually agent type)
            consumer_name: Unique consumer name (agent instance ID)
            handler: Async function to process events, returns True if successful
            event_types: Optional filter for specific event types
        """
        await self.connect()

        # Ensure consumer groups exist
        for stream in streams:
            await self._ensure_consumer_group(stream, consumer_group)

        self._running = True
        event_type_values = {et.value for et in event_types} if event_types else None

        logger.info(
            f"Starting subscription: consumer={consumer_name}, "
            f"group={consumer_group}, streams={streams}"
        )

        while self._running:
            try:
                # Read from streams using consumer group
                # '>' means only new messages not yet delivered to this group
                stream_ids = {stream: ">" for stream in streams}

                messages = await self._redis.xreadgroup(
                    groupname=consumer_group,
                    consumername=consumer_name,
                    streams=stream_ids,
                    count=self.READ_COUNT,
                    block=self.BLOCK_MS,
                )

                if not messages:
                    continue

                for stream_name, stream_messages in messages:
                    for message_id, message_data in stream_messages:
                        # Skip init messages
                        if "_init" in message_data:
                            await self._redis.xack(stream_name, consumer_group, message_id)
                            continue

                        # Parse event
                        try:
                            event_json = message_data.get("data", "{}")
                            event = SwarmEvent.from_json(event_json)
                        except Exception as e:
                            logger.error(f"Failed to parse event: {e}")
                            await self._redis.xack(stream_name, consumer_group, message_id)
                            continue

                        # Filter by event type if specified
                        event_type_value = (
                            event.event_type.value
                            if isinstance(event.event_type, EventType)
                            else event.event_type
                        )
                        if event_type_values and event_type_value not in event_type_values:
                            await self._redis.xack(stream_name, consumer_group, message_id)
                            continue

                        # Process event
                        try:
                            success = await handler(event)
                            if success:
                                await self._redis.xack(stream_name, consumer_group, message_id)
                                logger.debug(f"Processed and acked: {event.event_type}")
                            else:
                                # Don't ack - will be redelivered
                                logger.warning(
                                    f"Handler returned False for {event.event_type}, "
                                    "message will be redelivered"
                                )
                        except Exception as e:
                            logger.error(f"Handler error for {event.event_type}: {e}")
                            # Don't ack on error - will be redelivered

            except asyncio.CancelledError:
                logger.info(f"Consumer {consumer_name} cancelled")
                break
            except Exception as e:
                logger.error(f"Consumer {consumer_name} error: {e}")
                await asyncio.sleep(1)  # Brief pause before retry

        logger.info(f"Consumer {consumer_name} stopped")

    def start_consumer(
        self,
        streams: List[str],
        consumer_group: str,
        consumer_name: str,
        handler: Callable[[SwarmEvent], Awaitable[bool]],
        event_types: Optional[List[EventType]] = None,
    ) -> asyncio.Task:
        """
        Start a background consumer task.

        Returns the task for management.
        """
        task = asyncio.create_task(
            self.subscribe(
                streams=streams,
                consumer_group=consumer_group,
                consumer_name=consumer_name,
                handler=handler,
                event_types=event_types,
            )
        )
        self._consumer_tasks[consumer_name] = task
        return task

    async def get_pending_messages(
        self,
        stream: str,
        consumer_group: str,
        count: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        Get pending (unacknowledged) messages for a consumer group.

        Useful for monitoring and debugging.
        """
        await self.connect()

        try:
            pending = await self._redis.xpending_range(
                stream,
                consumer_group,
                min="-",
                max="+",
                count=count,
            )
            return pending
        except redis.ResponseError:
            return []

    async def claim_pending_messages(
        self,
        stream: str,
        consumer_group: str,
        consumer_name: str,
        min_idle_time_ms: int = 60000,
        count: int = 10,
    ) -> List[StreamMessage]:
        """
        Claim old pending messages from other consumers.

        Use this for recovering messages from dead consumers.

        Args:
            stream: Stream name
            consumer_group: Consumer group
            consumer_name: Consumer to claim messages for
            min_idle_time_ms: Only claim messages idle for this long
            count: Max messages to claim
        """
        await self.connect()

        try:
            # Get pending messages
            pending = await self._redis.xpending_range(
                stream,
                consumer_group,
                min="-",
                max="+",
                count=count,
            )

            claimed = []
            for entry in pending:
                # entry format: {'message_id': ..., 'consumer': ..., 'time_since_delivered': ..., 'times_delivered': ...}
                message_id = entry.get("message_id")
                idle_time = entry.get("time_since_delivered", 0)

                if idle_time >= min_idle_time_ms:
                    # Claim the message
                    messages = await self._redis.xclaim(
                        stream,
                        consumer_group,
                        consumer_name,
                        min_idle_time=min_idle_time_ms,
                        message_ids=[message_id],
                    )

                    for msg_id, msg_data in messages:
                        if "data" in msg_data:
                            event = SwarmEvent.from_json(msg_data["data"])
                            claimed.append(
                                StreamMessage(
                                    message_id=msg_id,
                                    stream=stream,
                                    event=event,
                                )
                            )

            return claimed

        except redis.ResponseError as e:
            logger.error(f"Failed to claim pending messages: {e}")
            return []

    async def get_stream_info(self, stream: str) -> Dict[str, Any]:
        """Get information about a stream"""
        await self.connect()

        try:
            info = await self._redis.xinfo_stream(stream)
            return info
        except redis.ResponseError:
            return {}

    async def get_consumer_group_info(
        self,
        stream: str,
        group: str,
    ) -> Dict[str, Any]:
        """Get information about a consumer group"""
        await self.connect()

        try:
            groups = await self._redis.xinfo_groups(stream)
            for g in groups:
                if g.get("name") == group:
                    return g
            return {}
        except redis.ResponseError:
            return {}
