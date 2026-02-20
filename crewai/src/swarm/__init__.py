"""
NextHello Swarm Architecture

A true swarm system with autonomous, peer-to-peer agent coordination.
Each agent decides independently when to act based on events and contact state.

Key Components:
- EventBus: Redis Streams-based pub/sub messaging
- Blackboard: Shared state management (Redis + PostgreSQL)
- AutonomousAgent: Base class for agents with should_act() logic
- SwarmCoordinator: Lightweight external message router

Agents:
- ResearchAgent: Contact enrichment via PDL
- QualificationAgent: Lead scoring and tier assignment
- PersonalizationAgent: Message and content generation
- VideoAgent: HeyGen video generation
- VoiceAgent: ElevenLabs voice messages
- CRMAgent: HubSpot synchronization

Usage:
    # Run the swarm as a standalone service
    python -m src.swarm.runner

    # Or integrate with the API
    from src.swarm import SwarmRunner
    runner = SwarmRunner()
    await runner.start()
"""

from .events import SwarmEvent, EventType, STREAM_NAMES
from .eventbus import EventBus
from .blackboard import Blackboard, ContactState
from .agent_runner import AutonomousAgent, AgentPool
from .coordinator import SwarmCoordinator
from .runner import SwarmRunner

__all__ = [
    # Events
    "SwarmEvent",
    "EventType",
    "STREAM_NAMES",
    # Infrastructure
    "EventBus",
    "Blackboard",
    "ContactState",
    # Agents
    "AutonomousAgent",
    "AgentPool",
    # Coordinator
    "SwarmCoordinator",
    # Runner
    "SwarmRunner",
]
