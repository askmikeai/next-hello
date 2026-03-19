"""
Context Cache - Hash-based prompt context caching.

Caches built context strings for contacts to avoid redundant
string construction on every message. Uses content-based hashing
to detect when context needs rebuilding.

Usage:
    context = ContextCache.get_or_build(
        contact,
        lambda c: build_contact_context(c),
        owner_id="user@example.com"
    )
"""

import hashlib
import time
import logging
from typing import Dict, Tuple, Callable, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .blackboard import ContactState

logger = logging.getLogger(__name__)


class ContextCache:
    """
    Hash-based context cache for contact data.

    Caches the built context string for each contact, keyed by
    (owner_id, phone_number). Uses content hashing to detect when
    the underlying data has changed and the cache needs refresh.

    Benefits:
    - Avoids redundant string building on every message
    - Automatically invalidates when contact data changes
    - Per-tenant isolation via owner_id prefixing
    - TTL-based expiry for stale entries
    """

    # Cache structure: key -> (content_hash, context_string, timestamp)
    _cache: Dict[str, Tuple[str, str, float]] = {}
    TTL: int = 300  # 5 minutes

    @classmethod
    def get_or_build(
        cls,
        contact: "ContactState",
        builder: Callable[["ContactState"], str],
        owner_id: Optional[str] = None,
    ) -> str:
        """
        Get cached context or build and cache it.

        Args:
            contact: Contact state to build context for
            builder: Function that builds context string from contact
            owner_id: Owner ID for cache key scoping

        Returns:
            Context string (from cache or freshly built)
        """
        key = cls._cache_key(owner_id or "", contact.phone_number)
        state_hash = cls._hash_contact(contact)
        now = time.time()

        if key in cls._cache:
            cached_hash, ctx, ts = cls._cache[key]
            # Check if hash matches and not expired
            if cached_hash == state_hash and (now - ts) < cls.TTL:
                logger.debug(f"ContextCache hit: {contact.phone_number}")
                return ctx

        # Build fresh context
        logger.debug(f"ContextCache miss: {contact.phone_number}")
        ctx = builder(contact)
        cls._cache[key] = (state_hash, ctx, now)
        return ctx

    @classmethod
    def invalidate(
        cls,
        phone_number: str,
        owner_id: Optional[str] = None,
    ) -> bool:
        """
        Invalidate cached context for a contact.

        Args:
            phone_number: Contact phone number
            owner_id: Owner ID

        Returns:
            True if entry was found and removed
        """
        key = cls._cache_key(owner_id or "", phone_number)
        if key in cls._cache:
            del cls._cache[key]
            return True
        return False

    @classmethod
    def clear(cls, owner_id: Optional[str] = None) -> int:
        """
        Clear cache entries.

        Args:
            owner_id: If provided, only clear entries for this owner.
                      If None, clear all entries.

        Returns:
            Number of entries cleared
        """
        if owner_id is None:
            count = len(cls._cache)
            cls._cache.clear()
            return count

        prefix = f"{owner_id}:"
        keys_to_remove = [k for k in cls._cache if k.startswith(prefix)]
        for key in keys_to_remove:
            del cls._cache[key]
        return len(keys_to_remove)

    @classmethod
    def cleanup_expired(cls) -> int:
        """
        Remove expired entries from cache.

        Returns:
            Number of entries removed
        """
        now = time.time()
        expired = [
            key for key, (_, _, ts) in cls._cache.items()
            if (now - ts) >= cls.TTL
        ]
        for key in expired:
            del cls._cache[key]

        if expired:
            logger.debug(f"ContextCache: Cleaned up {len(expired)} expired entries")

        return len(expired)

    @classmethod
    def stats(cls) -> Dict[str, int]:
        """
        Get cache statistics.

        Returns:
            Dict with cache stats
        """
        now = time.time()
        total = len(cls._cache)
        expired = sum(1 for _, _, ts in cls._cache.values() if (now - ts) >= cls.TTL)
        return {
            "total_entries": total,
            "expired_entries": expired,
            "active_entries": total - expired,
        }

    @classmethod
    def _cache_key(cls, owner_id: str, phone_number: str) -> str:
        """Build cache key from owner and phone."""
        return f"{owner_id}:{phone_number}"

    @classmethod
    def _hash_contact(cls, contact: "ContactState") -> str:
        """
        Create content hash of contact state.

        Only includes fields that affect context building.
        """
        # Include fields that typically appear in context
        parts = [
            contact.phone_number,
            contact.first_name or "",
            contact.last_name or "",
            contact.company_name or "",
            contact.job_title or "",
            contact.qualification_tier or "",
            str(contact.conversation_turns),
        ]

        # Include research data if present
        if contact.research_data:
            parts.append(str(sorted(contact.research_data.items())))

        content = "|".join(parts)
        return hashlib.md5(content.encode()).hexdigest()


# Convenience function for building standard contact context


def build_contact_context(contact: "ContactState") -> str:
    """
    Build a standard context string for a contact.

    This can be used as the builder function for ContextCache.get_or_build().

    Args:
        contact: Contact state

    Returns:
        Formatted context string
    """
    lines = []

    if contact.first_name:
        name = f"{contact.first_name} {contact.last_name or ''}".strip()
        lines.append(f"Name: {name}")
    if contact.company_name:
        lines.append(f"Company: {contact.company_name}")
    if contact.job_title:
        lines.append(f"Title: {contact.job_title}")

    research = contact.research_data or {}
    if research.get("skills"):
        skills = research["skills"][:5]
        lines.append(f"Skills: {', '.join(skills)}")
    if research.get("company_industry"):
        lines.append(f"Industry: {research['company_industry']}")

    if contact.qualification_tier:
        lines.append(f"Qualification: {contact.qualification_tier} lead")

    lines.append(f"Conversation turns: {contact.conversation_turns}")

    return "\n".join(lines) if lines else "No additional context available."
