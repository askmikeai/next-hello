"""
Unit tests for ContextCache.

Tests the hash-based prompt context caching functionality.
"""

import pytest
import time
from unittest.mock import MagicMock

from src.swarm.context_cache import ContextCache, build_contact_context
from src.swarm.blackboard import ContactState


def make_contact(**kwargs) -> ContactState:
    """Create a ContactState with default values."""
    defaults = {
        "phone_number": "1234567890",
        "first_name": None,
        "last_name": None,
        "company_name": None,
        "job_title": None,
        "qualification_tier": None,
        "conversation_turns": 0,
        "research_data": None,
    }
    defaults.update(kwargs)
    return ContactState(**defaults)


class TestContextCacheGetOrBuild:
    """Tests for ContextCache.get_or_build()"""

    def setup_method(self):
        """Clear cache before each test."""
        ContextCache.clear()

    def test_get_or_build_calls_builder_on_miss(self):
        """Should call builder function on cache miss."""
        contact = make_contact(first_name="John")
        builder = MagicMock(return_value="Built context")

        result = ContextCache.get_or_build(contact, builder, owner_id="test-owner")

        builder.assert_called_once_with(contact)
        assert result == "Built context"

    def test_get_or_build_returns_cached_on_hit(self):
        """Should return cached value without calling builder on hit."""
        contact = make_contact(first_name="John")
        builder = MagicMock(return_value="Built context")

        # First call - should call builder
        result1 = ContextCache.get_or_build(contact, builder, owner_id="test-owner")

        # Second call - should return cached value
        result2 = ContextCache.get_or_build(contact, builder, owner_id="test-owner")

        assert builder.call_count == 1
        assert result1 == result2

    def test_get_or_build_rebuilds_on_contact_change(self):
        """Should rebuild when contact data changes."""
        builder = MagicMock(side_effect=lambda c: f"Context for {c.first_name}")

        contact1 = make_contact(first_name="John")
        result1 = ContextCache.get_or_build(contact1, builder, owner_id="test-owner")

        # Change the contact
        contact2 = make_contact(first_name="Jane")
        result2 = ContextCache.get_or_build(contact2, builder, owner_id="test-owner")

        assert builder.call_count == 2
        assert result1 == "Context for John"
        assert result2 == "Context for Jane"

    def test_get_or_build_different_owners_different_caches(self):
        """Should maintain separate caches for different owners."""
        contact = make_contact(first_name="John")
        builder = MagicMock(side_effect=lambda c: f"Context for {c.first_name}")

        result1 = ContextCache.get_or_build(contact, builder, owner_id="owner-a")
        result2 = ContextCache.get_or_build(contact, builder, owner_id="owner-b")

        # Should be called twice because different owners
        assert builder.call_count == 2


class TestContextCacheInvalidate:
    """Tests for ContextCache.invalidate()"""

    def setup_method(self):
        """Clear cache before each test."""
        ContextCache.clear()

    def test_invalidate_removes_entry(self):
        """Should remove cached entry."""
        contact = make_contact(first_name="John")
        builder = MagicMock(return_value="Built context")

        # Populate cache
        ContextCache.get_or_build(contact, builder, owner_id="test-owner")

        # Invalidate
        result = ContextCache.invalidate("1234567890", owner_id="test-owner")

        assert result is True

        # Next call should rebuild
        ContextCache.get_or_build(contact, builder, owner_id="test-owner")
        assert builder.call_count == 2

    def test_invalidate_returns_false_for_missing(self):
        """Should return False when entry doesn't exist."""
        result = ContextCache.invalidate("nonexistent", owner_id="test-owner")

        assert result is False


class TestContextCacheClear:
    """Tests for ContextCache.clear()"""

    def setup_method(self):
        """Clear cache before each test."""
        ContextCache.clear()

    def test_clear_removes_all_entries(self):
        """Should remove all cached entries."""
        builder = MagicMock(return_value="Built context")

        contact1 = make_contact(phone_number="1111111111")
        contact2 = make_contact(phone_number="2222222222")

        ContextCache.get_or_build(contact1, builder, owner_id="test-owner")
        ContextCache.get_or_build(contact2, builder, owner_id="test-owner")

        assert ContextCache.stats()["total_entries"] == 2

        count = ContextCache.clear()

        assert count == 2
        assert ContextCache.stats()["total_entries"] == 0

    def test_clear_with_owner_id_only_clears_that_owner(self):
        """Should only clear entries for specified owner."""
        builder = MagicMock(return_value="Built context")

        contact = make_contact(phone_number="1234567890")

        ContextCache.get_or_build(contact, builder, owner_id="owner-a")
        ContextCache.get_or_build(contact, builder, owner_id="owner-b")

        assert ContextCache.stats()["total_entries"] == 2

        count = ContextCache.clear(owner_id="owner-a")

        assert count == 1
        assert ContextCache.stats()["total_entries"] == 1


class TestContextCacheStats:
    """Tests for ContextCache.stats()"""

    def setup_method(self):
        """Clear cache before each test."""
        ContextCache.clear()

    def test_stats_returns_correct_counts(self):
        """Should return correct entry counts."""
        builder = MagicMock(return_value="Built context")

        for i in range(5):
            contact = make_contact(phone_number=f"123456789{i}")
            ContextCache.get_or_build(contact, builder, owner_id="test-owner")

        stats = ContextCache.stats()

        assert stats["total_entries"] == 5
        assert stats["active_entries"] == 5
        assert stats["expired_entries"] == 0


class TestBuildContactContext:
    """Tests for build_contact_context() helper function."""

    def test_builds_context_with_all_fields(self):
        """Should include all available contact fields."""
        contact = make_contact(
            phone_number="1234567890",
            first_name="John",
            last_name="Doe",
            company_name="Acme Corp",
            job_title="Software Engineer",
            qualification_tier="hot",
            conversation_turns=5,
            research_data={"skills": ["Python", "ML"], "company_industry": "Technology"},
        )

        context = build_contact_context(contact)

        assert "John Doe" in context
        assert "Acme Corp" in context
        assert "Software Engineer" in context
        assert "hot lead" in context
        assert "Python" in context
        assert "Technology" in context
        assert "5" in context

    def test_builds_minimal_context_for_new_contact(self):
        """Should handle minimal contact data."""
        contact = make_contact(
            phone_number="1234567890",
            conversation_turns=0,
        )

        context = build_contact_context(contact)

        assert "Conversation turns: 0" in context

    def test_limits_skills_to_five(self):
        """Should only include first 5 skills."""
        contact = make_contact(
            research_data={
                "skills": ["a", "b", "c", "d", "e", "f", "g"],
            },
        )

        context = build_contact_context(contact)

        # Should have 5 skills, not 7
        skills_line = [l for l in context.split("\n") if "Skills:" in l]
        if skills_line:
            assert "f" not in skills_line[0]
            assert "g" not in skills_line[0]
