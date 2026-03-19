"""
Unit tests for LLMPool.

Tests the LLM instance pooling functionality.
Uses mocking to avoid requiring actual API keys.
"""

import pytest
from unittest.mock import patch, MagicMock

from src.swarm.llm_pool import LLMPool


# Mock LLM class for testing
class MockLLM:
    def __init__(self, model, temperature=0.7, max_tokens=None):
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens


class TestLLMPoolGet:
    """Tests for LLMPool.get()"""

    def setup_method(self):
        """Clear pool before each test."""
        LLMPool.clear()

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_get_creates_instance(self):
        """Should create a new instance when cache is empty."""
        llm = await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)

        assert llm is not None
        assert llm.model == "anthropic/claude-sonnet-4-20250514"

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_get_returns_cached_instance(self):
        """Should return the same instance for identical parameters."""
        llm1 = await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)
        llm2 = await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)

        assert llm1 is llm2

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_get_different_temperatures_different_instances(self):
        """Should create different instances for different temperatures."""
        llm1 = await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)
        llm2 = await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.3)

        assert llm1 is not llm2

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_get_different_models_different_instances(self):
        """Should create different instances for different models."""
        llm1 = await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)
        llm2 = await LLMPool.get("openai/gpt-4o", temperature=0.7)

        assert llm1 is not llm2

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_get_with_max_tokens(self):
        """Should include max_tokens in cache key."""
        llm1 = await LLMPool.get("anthropic/claude-sonnet-4-20250514", max_tokens=1024)
        llm2 = await LLMPool.get("anthropic/claude-sonnet-4-20250514", max_tokens=512)

        assert llm1 is not llm2


class TestLLMPoolGetSync:
    """Tests for LLMPool.get_sync()"""

    def setup_method(self):
        """Clear pool before each test."""
        LLMPool.clear()

    @patch("src.swarm.llm_pool.LLM", MockLLM)
    def test_get_sync_creates_instance(self):
        """Should create a new instance when cache is empty."""
        llm = LLMPool.get_sync("anthropic/claude-sonnet-4-20250514", temperature=0.7)

        assert llm is not None

    @patch("src.swarm.llm_pool.LLM", MockLLM)
    def test_get_sync_returns_cached_instance(self):
        """Should return the same instance for identical parameters."""
        llm1 = LLMPool.get_sync("openai/gpt-4o", temperature=0.8)
        llm2 = LLMPool.get_sync("openai/gpt-4o", temperature=0.8)

        assert llm1 is llm2


class TestLLMPoolClear:
    """Tests for LLMPool.clear()"""

    def setup_method(self):
        """Clear pool before each test."""
        LLMPool.clear()

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_clear_removes_all_instances(self):
        """Should remove all cached instances."""
        await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)
        await LLMPool.get("openai/gpt-4o", temperature=0.7)

        assert LLMPool.stats()["total_instances"] == 2

        LLMPool.clear()

        assert LLMPool.stats()["total_instances"] == 0


class TestLLMPoolStats:
    """Tests for LLMPool.stats()"""

    def setup_method(self):
        """Clear pool before each test."""
        LLMPool.clear()

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_stats_returns_correct_counts(self):
        """Should return correct instance counts."""
        await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)
        await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.3)
        await LLMPool.get("openai/gpt-4o", temperature=0.7)

        stats = LLMPool.stats()

        assert stats["total_instances"] == 3
        assert stats["models"] == 2  # 2 distinct model names


class TestLLMPoolKeys:
    """Tests for LLMPool.keys()"""

    def setup_method(self):
        """Clear pool before each test."""
        LLMPool.clear()

    @pytest.mark.asyncio
    @patch("src.swarm.llm_pool.LLM", MockLLM)
    async def test_keys_returns_all_cache_keys(self):
        """Should return all cache keys."""
        await LLMPool.get("anthropic/claude-sonnet-4-20250514", temperature=0.7)
        await LLMPool.get("openai/gpt-4o", temperature=0.8)

        keys = LLMPool.keys()

        assert len(keys) == 2
        assert any("anthropic" in k for k in keys)
        assert any("openai" in k for k in keys)
