"""
NextHello CrewAI State Management

Redis-based state management for conversation and contact state.
"""

from .redis_state import RedisStateManager, ConversationState

__all__ = ["RedisStateManager", "ConversationState"]
