"""
NextHello Conversation Orchestrator

DEPRECATED: This module is being phased out in favor of the event-driven
SwarmCoordinator + autonomous agents architecture.

To migrate:
1. Set ENABLE_SWARM_ONLY_MODE=true (default)
2. Use SwarmCoordinator.handle_incoming_message() instead of
   ConversationOrchestrator.process_message()
3. Response generation is handled by PersonalizationAgent

This module will be removed once the migration is complete.
"""

import warnings
from .conversation import ConversationOrchestrator

warnings.warn(
    "The orchestrator module is deprecated. Use SwarmCoordinator instead. "
    "Set ENABLE_SWARM_ONLY_MODE=true (default) to use the new architecture.",
    DeprecationWarning,
    stacklevel=2,
)

__all__ = ["ConversationOrchestrator"]
