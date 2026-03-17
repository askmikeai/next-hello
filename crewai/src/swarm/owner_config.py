"""
Per-owner configuration loader.

Reads from the ``owner_settings`` table and falls back to env vars when a
value is missing from the DB row.  Results are cached in-memory with a TTL
so agents don't hit Postgres on every event.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CACHE: dict[str, tuple[float, "OwnerConfig"]] = {}
_CACHE_TTL = 60  # seconds


# ---------------------------------------------------------------------------
# Default values (mirrors env-var fallbacks used before this module existed)
# ---------------------------------------------------------------------------

_ENV_DEFAULTS: dict[str, dict[str, Any]] = {
    "identity": {
        "owner_name": os.getenv("OWNER_NAME", ""),
        "owner_role": os.getenv("OWNER_ROLE", ""),
        "owner_location": os.getenv("OWNER_LOCATION", ""),
        "owner_interests": os.getenv("OWNER_INTERESTS", ""),
        "owner_favorite_place": os.getenv("OWNER_FAVORITE_PLACE", ""),
        "event_name": os.getenv("EVENT_NAME", ""),
        "calendly_url": os.getenv("CALENDLY_URL", ""),
    },
    "llm": {
        "primary_provider": os.getenv("LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514"),
        "openai_api_key": os.getenv("OPENAI_API_KEY", ""),
        "anthropic_api_key": os.getenv("ANTHROPIC_API_KEY", ""),
    },
    "heygen": {
        "api_key": os.getenv("HEYGEN_API_KEY", ""),
        "avatar_id": os.getenv("HEYGEN_AVATAR_ID", ""),
        "voice_id": os.getenv("HEYGEN_VOICE_ID", ""),
    },
    "elevenlabs": {
        "api_key": os.getenv("ELEVENLABS_API_KEY", ""),
        "voice_id": os.getenv("ELEVENLABS_VOICE_ID", ""),
    },
    "openclaw": {
        "enabled": bool(os.getenv("OPENCLAW_BASE_URL")),
        "base_url": os.getenv("OPENCLAW_BASE_URL", ""),
        "gateway_token": os.getenv("OPENCLAW_GATEWAY_TOKEN", ""),
        "hooks_token": os.getenv("OPENCLAW_HOOKS_TOKEN", ""),
        "research_url": os.getenv("OPENCLAW_RESEARCH_URL", ""),
        "api_key": os.getenv("OPENCLAW_API_KEY", ""),
        "timeout_seconds": int(os.getenv("OPENCLAW_TIMEOUT_SECONDS", "120")),
    },
    "crm": {
        "hubspot_api_key": os.getenv("HUBSPOT_API_KEY", ""),
    },
    "research": {
        "pdl_api_key": os.getenv("PDL_API_KEY", ""),
    },
    "behavior": {
        "moderation_mode": os.getenv("MODERATION_MODE", "false").lower()
        in ("1", "true", "yes", "on"),
        "demo_mode": os.getenv("DEMO_MODE", "false").lower() in ("1", "true", "yes", "on"),
        "webhook_base_url": os.getenv("WEBHOOK_BASE_URL", ""),
    },
    "goals": {
        "primary_goal": "book-meetings",
        "preferred_tone": "warm-professional",
        "speed": "balanced",
        "success_metric": "",
        "notes": "",
        "autopilot_enabled": True,
    },
}


# ---------------------------------------------------------------------------
# Schema definition – used by the /admin/api/settings/schema endpoint and
# the UI to render forms.
# ---------------------------------------------------------------------------

SETTINGS_SCHEMA: list[dict[str, Any]] = [
    {
        "section": "identity",
        "label": "Your Identity",
        "fields": [
            {"key": "owner_name", "label": "Your name", "type": "text"},
            {"key": "owner_role", "label": "Your role / title", "type": "text"},
            {"key": "owner_location", "label": "City", "type": "text"},
            {"key": "owner_interests", "label": "Interests", "type": "text"},
            {"key": "owner_favorite_place", "label": "Favorite place", "type": "text"},
            {"key": "event_name", "label": "Event name", "type": "text"},
            {"key": "calendly_url", "label": "Calendly link", "type": "url"},
        ],
    },
    {
        "section": "llm",
        "label": "AI Models",
        "fields": [
            {
                "key": "primary_provider",
                "label": "Primary LLM provider",
                "type": "select",
                "options": [
                    "anthropic/claude-sonnet-4-20250514",
                    "openai/gpt-4o",
                    "openai/gpt-4o-mini",
                ],
            },
            {"key": "anthropic_api_key", "label": "Anthropic API key", "type": "secret"},
            {"key": "openai_api_key", "label": "OpenAI API key", "type": "secret"},
        ],
    },
    {
        "section": "heygen",
        "label": "Video (HeyGen)",
        "fields": [
            {"key": "api_key", "label": "HeyGen API key", "type": "secret"},
            {"key": "avatar_id", "label": "Avatar ID", "type": "text"},
            {"key": "voice_id", "label": "Voice ID", "type": "text"},
        ],
    },
    {
        "section": "elevenlabs",
        "label": "Voice (ElevenLabs)",
        "fields": [
            {"key": "api_key", "label": "ElevenLabs API key", "type": "secret"},
            {"key": "voice_id", "label": "Voice ID", "type": "text"},
        ],
    },
    {
        "section": "openclaw",
        "label": "Research (OpenClaw)",
        "fields": [
            {"key": "enabled", "label": "Enable OpenClaw", "type": "toggle"},
            {"key": "base_url", "label": "Gateway base URL", "type": "url"},
            {"key": "gateway_token", "label": "Gateway token", "type": "secret"},
            {"key": "hooks_token", "label": "Hooks token", "type": "secret"},
            {"key": "research_url", "label": "Relay research URL", "type": "url"},
            {"key": "api_key", "label": "Relay API key", "type": "secret"},
            {"key": "timeout_seconds", "label": "Timeout (seconds)", "type": "number"},
        ],
    },
    {
        "section": "research",
        "label": "Research (People Data Labs)",
        "fields": [
            {"key": "pdl_api_key", "label": "PDL API key", "type": "secret"},
        ],
    },
    {
        "section": "crm",
        "label": "CRM (HubSpot)",
        "fields": [
            {"key": "hubspot_api_key", "label": "HubSpot API key", "type": "secret"},
        ],
    },
    {
        "section": "behavior",
        "label": "Behavior",
        "fields": [
            {"key": "moderation_mode", "label": "Moderation mode", "type": "toggle"},
            {"key": "demo_mode", "label": "Demo mode", "type": "toggle"},
            {"key": "webhook_base_url", "label": "Webhook base URL", "type": "url"},
        ],
    },
    {
        "section": "goals",
        "label": "Swarm Goals",
        "fields": [
            {
                "key": "primary_goal",
                "label": "Primary goal",
                "type": "select",
                "options": [
                    "book-meetings",
                    "qualify-leads",
                    "reactivate-pipeline",
                    "upsell-existing",
                ],
            },
            {
                "key": "preferred_tone",
                "label": "Conversation tone",
                "type": "select",
                "options": ["warm-professional", "direct-executive", "friendly-casual"],
            },
            {
                "key": "speed",
                "label": "Response speed",
                "type": "select",
                "options": ["fast", "balanced", "careful"],
            },
            {"key": "success_metric", "label": "Success metric", "type": "text"},
            {"key": "notes", "label": "Notes for agents", "type": "textarea"},
            {"key": "autopilot_enabled", "label": "Keep autopilot enabled", "type": "toggle"},
        ],
    },
]

# Build a set of secret field paths for masking
_SECRET_PATHS: set[tuple[str, str]] = set()
for _sec in SETTINGS_SCHEMA:
    for _f in _sec["fields"]:
        if _f.get("type") == "secret":
            _SECRET_PATHS.add((_sec["section"], _f["key"]))


# ---------------------------------------------------------------------------
# OwnerConfig dataclass
# ---------------------------------------------------------------------------


@dataclass
class OwnerConfig:
    owner_id: str
    _raw: dict[str, Any] = field(default_factory=dict)

    # -- section accessors ---------------------------------------------------

    def section(self, name: str) -> dict[str, Any]:
        db_section = self._raw.get(name) or {}
        defaults = _ENV_DEFAULTS.get(name) or {}
        merged: dict[str, Any] = {}
        for key, default_val in defaults.items():
            val = db_section.get(key)
            if val is None or val == "":
                merged[key] = default_val
            else:
                merged[key] = val
        # Include any extra keys from DB that aren't in defaults
        for key, val in db_section.items():
            if key not in merged:
                merged[key] = val
        return merged

    @property
    def identity(self) -> dict[str, Any]:
        return self.section("identity")

    @property
    def llm(self) -> dict[str, Any]:
        return self.section("llm")

    @property
    def heygen(self) -> dict[str, Any]:
        return self.section("heygen")

    @property
    def elevenlabs(self) -> dict[str, Any]:
        return self.section("elevenlabs")

    @property
    def openclaw(self) -> dict[str, Any]:
        return self.section("openclaw")

    @property
    def crm(self) -> dict[str, Any]:
        return self.section("crm")

    @property
    def research(self) -> dict[str, Any]:
        return self.section("research")

    @property
    def behavior(self) -> dict[str, Any]:
        return self.section("behavior")

    @property
    def goals(self) -> dict[str, Any]:
        return self.section("goals")

    # -- convenience getters -------------------------------------------------

    def get(self, section: str, key: str, default: Any = None) -> Any:
        return self.section(section).get(key, default)

    # -- full config (for API response) --------------------------------------

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for sec_def in SETTINGS_SCHEMA:
            result[sec_def["section"]] = self.section(sec_def["section"])
        return result

    def to_masked_dict(self) -> dict[str, Any]:
        result = self.to_dict()
        for section_key, field_key in _SECRET_PATHS:
            sec = result.get(section_key)
            if sec and sec.get(field_key):
                val = str(sec[field_key])
                if len(val) > 8:
                    sec[field_key] = val[:4] + "***" + val[-4:]
                else:
                    sec[field_key] = "***"
        return result


# ---------------------------------------------------------------------------
# Async loader  (requires an asyncpg pool)
# ---------------------------------------------------------------------------


async def load_owner_config(
    pool,  # asyncpg.Pool
    owner_id: str,
) -> OwnerConfig:
    """Load config from DB with in-memory cache."""
    now = time.monotonic()
    cached = _CACHE.get(owner_id)
    if cached and (now - cached[0]) < _CACHE_TTL:
        return cached[1]

    raw: dict[str, Any] = {}
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT config FROM owner_settings WHERE owner_id = $1",
                owner_id,
            )
        if row:
            raw = (
                json.loads(row["config"])
                if isinstance(row["config"], str)
                else (row["config"] or {})
            )
    except Exception as exc:
        logger.warning(f"Failed to load owner_settings for {owner_id}: {exc}")

    config = OwnerConfig(owner_id=owner_id, _raw=raw)
    _CACHE[owner_id] = (now, config)
    return config


async def save_owner_config(
    pool,  # asyncpg.Pool
    owner_id: str,
    updates: dict[str, Any],
) -> OwnerConfig:
    """Merge partial updates into the owner's config and persist."""
    # Load current
    current = await load_owner_config(pool, owner_id)
    merged_raw = dict(current._raw)

    for section_key, section_updates in updates.items():
        if not isinstance(section_updates, dict):
            continue
        existing_section = dict(merged_raw.get(section_key) or {})
        existing_section.update(section_updates)
        merged_raw[section_key] = existing_section

    config_json = json.dumps(merged_raw)

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO owner_settings (owner_id, config, updated_at)
                VALUES ($1, $2::jsonb, NOW())
                ON CONFLICT (owner_id)
                DO UPDATE SET config = $2::jsonb, updated_at = NOW()
                """,
                owner_id,
                config_json,
            )
    except Exception as exc:
        logger.error(f"Failed to save owner_settings for {owner_id}: {exc}")
        raise

    # Invalidate cache
    _CACHE.pop(owner_id, None)

    return await load_owner_config(pool, owner_id)


def invalidate_cache(owner_id: Optional[str] = None) -> None:
    """Clear cached config.  Pass ``None`` to clear all."""
    if owner_id:
        _CACHE.pop(owner_id, None)
    else:
        _CACHE.clear()
