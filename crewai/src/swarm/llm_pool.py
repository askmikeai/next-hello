"""
LLM Pool - Shared LLM instance management.

Provides singleton LLM instances to avoid creating duplicate clients.
Each unique (model, temperature) combination gets a single instance
that's shared across all agents.

Usage:
    llm = await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)
"""

import asyncio
import logging
from typing import Dict, Optional, TYPE_CHECKING

from crewai import LLM

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class LLMPool:
    """
    Shared pool of LLM instances.

    Maintains singleton instances for each unique (model, temperature) combination.
    Thread-safe through asyncio locks.

    Benefits:
    - Reduces memory usage by sharing LLM clients
    - Avoids redundant API client initialization
    - Provides consistent configuration across agents
    """

    _instances: Dict[str, LLM] = {}
    _lock: asyncio.Lock = asyncio.Lock()
    _initialized: bool = False

    @classmethod
    async def get(
        cls,
        model: str,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> LLM:
        """
        Get or create an LLM instance.

        Args:
            model: Model identifier (e.g., "anthropic/claude-sonnet-4-20250514")
            temperature: Sampling temperature
            max_tokens: Maximum tokens for response (optional)

        Returns:
            Shared LLM instance for the given configuration
        """
        # Build cache key
        key = f"{model}:{temperature}:{max_tokens or 'default'}"

        # Fast path - check without lock
        if key in cls._instances:
            return cls._instances[key]

        # Slow path - create with lock
        async with cls._lock:
            # Double-check after acquiring lock
            if key not in cls._instances:
                logger.debug(f"Creating LLM instance: {key}")

                # Build kwargs based on model type
                kwargs = {
                    "model": model,
                    "temperature": temperature,
                }

                # Anthropic models need max_tokens
                if model.startswith("anthropic/") and max_tokens:
                    kwargs["max_tokens"] = max_tokens
                elif model.startswith("anthropic/"):
                    kwargs["max_tokens"] = 1024  # Default for Anthropic

                cls._instances[key] = LLM(**kwargs)
                logger.info(f"LLMPool: Created instance for {model}")

        return cls._instances[key]

    @classmethod
    def get_sync(
        cls,
        model: str,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> LLM:
        """
        Synchronous version of get() for non-async contexts.

        Note: This creates new instances without lock protection.
        Use async get() when possible.
        """
        key = f"{model}:{temperature}:{max_tokens or 'default'}"

        if key not in cls._instances:
            kwargs = {
                "model": model,
                "temperature": temperature,
            }

            if model.startswith("anthropic/") and max_tokens:
                kwargs["max_tokens"] = max_tokens
            elif model.startswith("anthropic/"):
                kwargs["max_tokens"] = 1024

            cls._instances[key] = LLM(**kwargs)
            logger.info(f"LLMPool: Created instance for {model} (sync)")

        return cls._instances[key]

    @classmethod
    def clear(cls) -> None:
        """
        Clear all cached LLM instances.

        Useful for testing or when configuration changes.
        """
        cls._instances.clear()
        logger.info("LLMPool: Cleared all instances")

    @classmethod
    def stats(cls) -> Dict[str, int]:
        """
        Get pool statistics.

        Returns:
            Dict with pool stats
        """
        return {
            "total_instances": len(cls._instances),
            "models": len(set(k.split(":")[0] for k in cls._instances.keys())),
        }

    @classmethod
    def keys(cls) -> list[str]:
        """
        Get all cache keys (for debugging).

        Returns:
            List of cache keys
        """
        return list(cls._instances.keys())


# Convenience functions for common model configurations


async def get_anthropic_llm(
    temperature: float = 0.7,
    max_tokens: int = 1024,
    model: str = "anthropic/claude-sonnet-4-20250514",
) -> LLM:
    """Get a pooled Anthropic Claude LLM instance."""
    return await LLMPool.get(model, temperature=temperature, max_tokens=max_tokens)


async def get_openai_llm(
    temperature: float = 0.7,
    model: str = "openai/gpt-4o",
) -> LLM:
    """Get a pooled OpenAI GPT LLM instance."""
    return await LLMPool.get(model, temperature=temperature)
