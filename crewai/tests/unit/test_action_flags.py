"""
Unit tests for ActionFlags dataclass.

Tests the action flags functionality for consolidated events.
"""

import pytest

from src.swarm.events import ActionFlags


class TestActionFlagsInit:
    """Tests for ActionFlags initialization."""

    def test_default_values(self):
        """All flags should default to False."""
        flags = ActionFlags()

        assert flags.needs_research is False
        assert flags.needs_qualification is False
        assert flags.needs_video is False
        assert flags.needs_voice is False
        assert flags.needs_crm_sync is False

    def test_custom_values(self):
        """Should accept custom values for each flag."""
        flags = ActionFlags(
            needs_research=True,
            needs_video=True,
        )

        assert flags.needs_research is True
        assert flags.needs_qualification is False
        assert flags.needs_video is True
        assert flags.needs_voice is False
        assert flags.needs_crm_sync is False


class TestActionFlagsToDict:
    """Tests for ActionFlags.to_dict()."""

    def test_to_dict_all_false(self):
        """Should convert to dict with all False values."""
        flags = ActionFlags()
        result = flags.to_dict()

        assert result == {
            "needs_research": False,
            "needs_qualification": False,
            "needs_video": False,
            "needs_voice": False,
            "needs_crm_sync": False,
        }

    def test_to_dict_mixed_values(self):
        """Should convert to dict preserving True/False."""
        flags = ActionFlags(
            needs_research=True,
            needs_crm_sync=True,
        )
        result = flags.to_dict()

        assert result == {
            "needs_research": True,
            "needs_qualification": False,
            "needs_video": False,
            "needs_voice": False,
            "needs_crm_sync": True,
        }


class TestActionFlagsFromDict:
    """Tests for ActionFlags.from_dict()."""

    def test_from_dict_empty(self):
        """Should create with defaults from empty dict."""
        flags = ActionFlags.from_dict({})

        assert flags.needs_research is False
        assert flags.needs_video is False

    def test_from_dict_with_values(self):
        """Should create from dict with values."""
        flags = ActionFlags.from_dict({
            "needs_research": True,
            "needs_video": True,
            "needs_voice": False,
        })

        assert flags.needs_research is True
        assert flags.needs_video is True
        assert flags.needs_voice is False
        assert flags.needs_crm_sync is False

    def test_from_dict_handles_truthy_values(self):
        """Should coerce truthy values to bool."""
        flags = ActionFlags.from_dict({
            "needs_research": 1,
            "needs_video": "yes",
        })

        assert flags.needs_research is True
        assert flags.needs_video is True

    def test_roundtrip(self):
        """to_dict and from_dict should be reversible."""
        original = ActionFlags(
            needs_research=True,
            needs_qualification=True,
            needs_video=False,
            needs_voice=True,
            needs_crm_sync=False,
        )

        restored = ActionFlags.from_dict(original.to_dict())

        assert restored.needs_research == original.needs_research
        assert restored.needs_qualification == original.needs_qualification
        assert restored.needs_video == original.needs_video
        assert restored.needs_voice == original.needs_voice
        assert restored.needs_crm_sync == original.needs_crm_sync
