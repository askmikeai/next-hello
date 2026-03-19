"""
Unit tests for qualification scoring optimization.

Tests that scoring is calculated once per qualification, not multiple times.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call

from src.swarm.blackboard import ContactState
from src.swarm.agents.qualification_agent import QualificationAgent
from tests.helpers.fakes import FakeEventBus, FakeBlackboard
from tests.helpers.agent_harness import event_factory
from src.swarm.events import EventType


class TestQualifyContactReturnsFactors:
    """Tests for _qualify_contact returning factors dict."""

    @pytest.fixture
    def agent(self):
        """Create qualification agent for testing."""
        eventbus = FakeEventBus()
        blackboard = FakeBlackboard()
        return QualificationAgent(eventbus, blackboard)

    @pytest.mark.asyncio
    async def test_returns_four_elements(self, agent):
        """_qualify_contact should return (score, tier, reasoning, factors)."""
        contact = ContactState(
            phone_number="1234567890",
            job_title="CEO",
            company_name="Acme Corp",
            email="test@example.com",
        )

        result = await agent._qualify_contact(contact)

        assert len(result) == 4
        score, tier, reasoning, factors = result
        assert isinstance(score, int)
        assert isinstance(tier, str)
        assert isinstance(reasoning, str)
        assert isinstance(factors, dict)

    @pytest.mark.asyncio
    async def test_factors_dict_structure(self, agent):
        """Factors dict should have expected structure."""
        contact = ContactState(
            phone_number="1234567890",
            job_title="CTO",
            company_name="TechCorp",
            email="cto@techcorp.com",
            linkedin_url="https://linkedin.com/in/test",
            conversation_turns=3,
        )

        _, _, _, factors = await agent._qualify_contact(contact)

        assert "job_title" in factors
        assert "company" in factors
        assert "engagement" in factors
        assert "completeness" in factors

        # Each factor should have a score
        assert "score" in factors["job_title"]
        assert "score" in factors["company"]
        assert "score" in factors["engagement"]
        assert "score" in factors["completeness"]

    @pytest.mark.asyncio
    async def test_scores_match_between_result_and_factors(self, agent):
        """Total score should equal sum of individual factor scores."""
        contact = ContactState(
            phone_number="1234567890",
            job_title="VP Engineering",
            company_name="Big Tech Inc",
            email="vp@bigtech.com",
            first_name="John",
            last_name="Doe",
            conversation_turns=6,
        )

        score, _, _, factors = await agent._qualify_contact(contact)

        calculated_sum = (
            factors["job_title"]["score"]
            + factors["company"]["score"]
            + factors["engagement"]["score"]
            + factors["completeness"]["score"]
        )

        assert score == calculated_sum


class TestScoringCalledOnce:
    """Tests that scoring methods are only called once per qualification."""

    @pytest.fixture
    def agent(self):
        """Create qualification agent for testing."""
        eventbus = FakeEventBus()
        blackboard = FakeBlackboard()
        return QualificationAgent(eventbus, blackboard)

    @pytest.mark.asyncio
    async def test_score_job_title_called_once(self, agent):
        """_score_job_title should only be called once per qualification."""
        contact = ContactState(
            phone_number="1234567890",
            job_title="CEO",
        )

        with patch.object(
            agent, "_score_job_title", wraps=agent._score_job_title
        ) as mock_score:
            await agent._qualify_contact(contact)
            assert mock_score.call_count == 1

    @pytest.mark.asyncio
    async def test_score_company_called_once(self, agent):
        """_score_company should only be called once per qualification."""
        contact = ContactState(
            phone_number="1234567890",
            company_name="Acme",
        )

        with patch.object(
            agent, "_score_company", wraps=agent._score_company
        ) as mock_score:
            await agent._qualify_contact(contact)
            assert mock_score.call_count == 1

    @pytest.mark.asyncio
    async def test_score_engagement_called_once(self, agent):
        """_score_engagement should only be called once per qualification."""
        contact = ContactState(
            phone_number="1234567890",
            conversation_turns=10,
        )

        with patch.object(
            agent, "_score_engagement", wraps=agent._score_engagement
        ) as mock_score:
            await agent._qualify_contact(contact)
            assert mock_score.call_count == 1

    @pytest.mark.asyncio
    async def test_score_completeness_called_once(self, agent):
        """_score_completeness should only be called once per qualification."""
        contact = ContactState(
            phone_number="1234567890",
            email="test@example.com",
        )

        with patch.object(
            agent, "_score_completeness", wraps=agent._score_completeness
        ) as mock_score:
            await agent._qualify_contact(contact)
            assert mock_score.call_count == 1


class TestTierAssignment:
    """Tests for tier assignment based on score."""

    @pytest.fixture
    def agent(self):
        """Create qualification agent for testing."""
        eventbus = FakeEventBus()
        blackboard = FakeBlackboard()
        return QualificationAgent(eventbus, blackboard)

    @pytest.mark.asyncio
    async def test_hot_tier_threshold(self, agent):
        """Score >= 75 should result in 'hot' tier."""
        # Create contact that will score high (CEO = 30, good engagement, etc.)
        contact = ContactState(
            phone_number="1234567890",
            job_title="CEO",  # 30 points
            company_name="Big Corp",
            email="ceo@bigcorp.com",  # 5 points
            linkedin_url="https://linkedin.com/in/ceo",  # 5 points
            first_name="John",
            last_name="Doe",  # 3 points
            conversation_turns=10,  # 15 points
            research_data={"company_size": "enterprise"},  # 15 points
        )

        score, tier, _, _ = await agent._qualify_contact(contact)

        assert score >= 75
        assert tier == "hot"

    @pytest.mark.asyncio
    async def test_unqualified_tier_threshold(self, agent):
        """Score < 25 should result in 'unqualified' tier."""
        contact = ContactState(
            phone_number="1234567890",
            # Minimal info - should score very low
        )

        score, tier, _, _ = await agent._qualify_contact(contact)

        assert score < 25
        assert tier == "unqualified"
