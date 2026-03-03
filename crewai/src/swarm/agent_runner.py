"""
Agent Runner - Base Class for Autonomous Agents

Provides the foundation for autonomous agents in the swarm.
Each agent:
- Subscribes to relevant event streams
- Decides independently when to act (should_act)
- Executes actions and publishes results
- Manages its own state and lifecycle
"""

import os
import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Optional, List, Set
from datetime import datetime
import uuid

from .events import SwarmEvent, EventType, STREAM_NAMES
from .eventbus import EventBus
from .blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)


class AutonomousAgent(ABC):
    """
    Base class for autonomous swarm agents.

    Subclasses must implement:
    - name: Agent identifier
    - subscribed_events: Event types this agent responds to
    - should_act: Decision logic for whether to process an event
    - execute: The actual work the agent does
    """

    def __init__(
        self,
        eventbus: EventBus,
        blackboard: Blackboard,
        instance_id: Optional[str] = None,
    ):
        self.eventbus = eventbus
        self.blackboard = blackboard
        self.instance_id = instance_id or str(uuid.uuid4())[:8]
        self._running = False
        self._task: Optional[asyncio.Task] = None

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique name for this agent type"""
        pass

    @property
    @abstractmethod
    def subscribed_events(self) -> List[EventType]:
        """Event types this agent subscribes to"""
        pass

    @property
    def consumer_name(self) -> str:
        """Unique consumer name for this instance"""
        return f"{self.name}-{self.instance_id}"

    @property
    def consumer_group(self) -> str:
        """Consumer group for this agent type"""
        return f"swarm-agent-{self.name}"

    def get_streams(self) -> List[str]:
        """Get Redis stream names for subscribed events"""
        streams: Set[str] = set()
        for event_type in self.subscribed_events:
            prefix = event_type.value.split(".")[0]
            stream = STREAM_NAMES.get(prefix)
            if stream:
                streams.add(stream)
        return list(streams)

    @abstractmethod
    async def should_act(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> bool:
        """
        Determine if this agent should act on the event.

        This is the agent's autonomy logic - it decides independently
        whether to process an event based on contact state.

        Args:
            event: The incoming event
            contact: Current contact state from blackboard

        Returns:
            True if the agent should process this event
        """
        pass

    @abstractmethod
    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute the agent's task.

        Args:
            event: The triggering event
            contact: Current contact state

        Returns:
            List of events to publish as a result
        """
        pass

    async def handle_event(self, event: SwarmEvent) -> bool:
        """
        Handle an incoming event.

        This is called by the event bus for each matching event.

        Returns:
            True if event was processed successfully
        """
        logger.debug(f"[{self.name}] Received event: {event.event_type}")

        activity_id: Optional[str] = None
        started_at: Optional[datetime] = None

        try:
            # Get contact state from blackboard
            contact = await self.blackboard.get_contact(event.contact_id)
            if not contact:
                contact = ContactState(phone_number=event.contact_id)

            # Check if we should act
            if not await self.should_act(event, contact):
                logger.debug(f"[{self.name}] Skipping event for {event.contact_id}")
                return True  # Acknowledge but don't process

            # Acquire lock for this contact
            lock_acquired = await self.blackboard.acquire_lock(
                event.contact_id,
                self.consumer_name,
            )
            if not lock_acquired:
                logger.debug(f"[{self.name}] Could not acquire lock for {event.contact_id}")
                return False  # Don't ack - will retry

            try:
                # Update agent state
                await self.blackboard.save_agent_state(
                    self.name,
                    event.contact_id,
                    "processing",
                    event.event_id,
                )

                # Record activity start
                started_at = datetime.utcnow()
                action = event.event_type.value if isinstance(event.event_type, EventType) else str(event.event_type)
                activity_id = await self.blackboard.log_agent_activity_start(
                    agent_type=self.name,
                    action=action,
                    correlation_id=event.correlation_id,
                    started_at=started_at,
                )

                # Execute the agent's logic
                logger.info(f"[{self.name}] Executing for {event.contact_id}")
                result_events = await self.execute(event, contact)

                # Publish result events
                for result_event in result_events:
                    await self.eventbus.publish(result_event)
                    logger.info(f"[{self.name}] Published {result_event.event_type}")

                # Log the event
                await self.blackboard.log_event(event)

                # Record activity completion
                completed_at = datetime.utcnow()
                duration_ms = int((completed_at - started_at).total_seconds() * 1000)
                await self.blackboard.log_agent_activity_complete(
                    activity_id=activity_id,
                    status="completed",
                    completed_at=completed_at,
                    duration_ms=duration_ms,
                )

                # Update agent state
                await self.blackboard.save_agent_state(
                    self.name,
                    event.contact_id,
                    "completed",
                    event.event_id,
                )

                logger.info(f"[{self.name}] Completed for {event.contact_id}")
                return True

            finally:
                # Always release lock
                await self.blackboard.release_lock(
                    event.contact_id,
                    self.consumer_name,
                )

        except Exception as e:
            logger.error(f"[{self.name}] Error handling event: {e}", exc_info=True)

            # Record activity failure
            if activity_id and started_at:
                try:
                    completed_at = datetime.utcnow()
                    duration_ms = int((completed_at - started_at).total_seconds() * 1000)
                    await self.blackboard.log_agent_activity_complete(
                        activity_id=activity_id,
                        status="failed",
                        completed_at=completed_at,
                        duration_ms=duration_ms,
                        error_message=str(e)[:500],
                    )
                except Exception:
                    pass

            # Update agent state to failed
            try:
                await self.blackboard.save_agent_state(
                    self.name,
                    event.contact_id,
                    f"failed: {str(e)[:100]}",
                    event.event_id,
                )
            except Exception:
                pass

            return False  # Don't ack - will retry

    async def start(self) -> None:
        """Start the agent"""
        if self._running:
            return

        self._running = True
        streams = self.get_streams()

        logger.info(
            f"[{self.name}] Starting agent "
            f"(instance={self.instance_id}, streams={streams})"
        )

        self._task = self.eventbus.start_consumer(
            streams=streams,
            consumer_group=self.consumer_group,
            consumer_name=self.consumer_name,
            handler=self.handle_event,
            event_types=self.subscribed_events,
        )

    async def stop(self) -> None:
        """Stop the agent"""
        self._running = False

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        logger.info(f"[{self.name}] Stopped")

    async def run(self) -> None:
        """Run the agent until stopped"""
        await self.start()

        try:
            while self._running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            await self.stop()


class AgentPool:
    """
    Manages a pool of autonomous agents.

    Provides lifecycle management for multiple agents.
    """

    def __init__(
        self,
        eventbus: EventBus,
        blackboard: Blackboard,
    ):
        self.eventbus = eventbus
        self.blackboard = blackboard
        self._agents: List[AutonomousAgent] = []
        self._running = False

    def add_agent(self, agent: AutonomousAgent) -> None:
        """Add an agent to the pool"""
        self._agents.append(agent)
        logger.info(f"Added agent: {agent.name}")

    async def start_all(self) -> None:
        """Start all agents"""
        self._running = True

        await self.eventbus.connect()
        await self.blackboard.connect()

        for agent in self._agents:
            await agent.start()

        logger.info(f"Started {len(self._agents)} agents")

    async def stop_all(self) -> None:
        """Stop all agents"""
        self._running = False

        for agent in self._agents:
            await agent.stop()

        await self.eventbus.close()
        await self.blackboard.close()

        logger.info(f"Stopped {len(self._agents)} agents")

    async def run(self) -> None:
        """Run all agents until stopped"""
        await self.start_all()

        try:
            while self._running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass
        finally:
            await self.stop_all()

    def get_agent(self, name: str) -> Optional[AutonomousAgent]:
        """Get an agent by name"""
        for agent in self._agents:
            if agent.name == name:
                return agent
        return None

    @property
    def agents(self) -> List[AutonomousAgent]:
        """Get all agents"""
        return self._agents.copy()
