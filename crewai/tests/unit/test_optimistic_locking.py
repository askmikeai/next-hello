"""
Unit tests for optimistic locking in Blackboard.

Tests the version-based optimistic concurrency control.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.swarm.blackboard import ContactState, Blackboard


class TestContactStateVersion:
    """Tests for ContactState version field."""

    def test_default_version_is_zero(self):
        """New contacts should have version 0."""
        contact = ContactState(phone_number="1234567890")
        assert contact.version == 0

    def test_to_dict_includes_version(self):
        """to_dict should include version field."""
        contact = ContactState(phone_number="1234567890", version=5)
        result = contact.to_dict()
        assert result["version"] == 5

    def test_from_dict_with_version(self):
        """from_dict should restore version."""
        data = {
            "phone_number": "1234567890",
            "version": 3,
        }
        contact = ContactState.from_dict(data)
        assert contact.version == 3

    def test_from_dict_default_version(self):
        """from_dict should default version to 0 if missing."""
        data = {"phone_number": "1234567890"}
        contact = ContactState.from_dict(data)
        assert contact.version == 0


class TestOptimisticUpdate:
    """Tests for Blackboard.update_contact_optimistic()."""

    @pytest.fixture
    def mock_blackboard(self):
        """Create blackboard with mocked backends."""
        blackboard = Blackboard()
        blackboard._redis = MagicMock()
        blackboard._pool = MagicMock()
        return blackboard

    @pytest.mark.asyncio
    async def test_optimistic_update_success(self, mock_blackboard):
        """Should succeed when version matches."""
        # Mock successful update
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={
            "phone_number": "1234567890",
            "version": 2,  # Incremented from 1
            "first_name": "John",
            "pending_actions": "{}",
        })

        mock_blackboard._pool.acquire = MagicMock(
            return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_conn))
        )
        mock_blackboard._redis.setex = AsyncMock()

        state, success = await mock_blackboard.update_contact_optimistic(
            contact_id="1234567890",
            expected_version=1,
            owner_id="test-owner",
            first_name="John",
        )

        assert success is True
        assert state.first_name == "John"
        assert state.version == 2

    @pytest.mark.asyncio
    async def test_optimistic_update_version_mismatch(self, mock_blackboard):
        """Should return False when version doesn't match."""
        # Mock failed update (no row returned)
        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)

        mock_blackboard._pool.acquire = MagicMock(
            return_value=AsyncMock(__aenter__=AsyncMock(return_value=mock_conn))
        )
        mock_blackboard._redis.get = AsyncMock(return_value=None)

        # Mock get_contact to return current state
        with patch.object(
            mock_blackboard,
            "get_contact",
            AsyncMock(return_value=ContactState(phone_number="1234567890", version=5))
        ):
            state, success = await mock_blackboard.update_contact_optimistic(
                contact_id="1234567890",
                expected_version=1,  # Stale version
                owner_id="test-owner",
                first_name="John",
            )

        assert success is False
        assert state.version == 5  # Returns current version

    @pytest.mark.asyncio
    async def test_optimistic_update_without_db_falls_back(self, mock_blackboard):
        """Should fall back to regular update without DB."""
        mock_blackboard._pool = None  # No DB connection

        with patch.object(
            mock_blackboard,
            "update_contact",
            AsyncMock(return_value=ContactState(phone_number="1234567890"))
        ) as mock_update:
            state, success = await mock_blackboard.update_contact_optimistic(
                contact_id="1234567890",
                expected_version=1,
                first_name="John",
            )

        assert success is True
        mock_update.assert_called_once()
