"""
NextHello CrewAI - Multi-Agent Networking Assistant

A CrewAI-based implementation of the networking follow-up system.
Supports multiple LLM providers (Anthropic, OpenAI, Google, etc.)
"""

from .agents import NetworkingAgents
from .crews import NetworkingCrew

__all__ = ["NetworkingAgents", "NetworkingCrew"]
__version__ = "0.1.0"
