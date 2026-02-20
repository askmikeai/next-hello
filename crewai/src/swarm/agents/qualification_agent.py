"""
Qualification Agent - Lead scoring and tier assignment

Subscribes to: research.completed, message.received, qualification.needed
Publishes: qualification.completed, video.requested, crm.sync_needed
"""

import os
import logging
from typing import List
from datetime import datetime, timedelta

from crewai import Agent, Task, Crew, LLM

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..eventbus import EventBus
from ..blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)


class QualificationAgent(AutonomousAgent):
    """
    Autonomous agent for lead qualification and scoring.

    Evaluates contacts based on:
    - Job title and seniority
    - Company size and industry
    - Engagement level (conversation turns)
    - Research data completeness

    Assigns tiers: hot, warm, cold, unqualified

    Autonomy logic:
    - Acts after research completion
    - Re-qualifies if significant engagement changes
    - Triggers video/CRM based on qualification tier
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._llm = None

    @property
    def llm(self) -> LLM:
        """Get LLM instance for qualification reasoning"""
        if self._llm is None:
            llm_provider = os.getenv("LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514")
            if llm_provider.startswith("anthropic/"):
                self._llm = LLM(model=llm_provider, max_tokens=1024, temperature=0.3)
            else:
                self._llm = LLM(model=llm_provider, temperature=0.3)
        return self._llm

    @property
    def name(self) -> str:
        return "qualification"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [
            EventType.RESEARCH_COMPLETED,
            EventType.MESSAGE_RECEIVED,
            EventType.QUALIFICATION_NEEDED,
        ]

    async def should_act(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> bool:
        """
        Decide if we should qualify this contact.

        Conditions for acting:
        1. For research.completed: always qualify
        2. For message.received: only if significant engagement change
        3. Don't re-qualify within 24 hours unless major change
        """
        # Always qualify after research completion
        if event.event_type == EventType.RESEARCH_COMPLETED:
            return True

        # Always qualify if explicitly requested
        if event.event_type == EventType.QUALIFICATION_NEEDED:
            return True

        # For messages, check if this warrants re-qualification
        if event.event_type == EventType.MESSAGE_RECEIVED:
            # Skip if recently qualified
            if contact.qualification_updated_at:
                try:
                    last_qualified = datetime.fromisoformat(contact.qualification_updated_at)
                    if datetime.utcnow() - last_qualified < timedelta(hours=24):
                        # Only re-qualify on significant engagement
                        if contact.conversation_turns < 5:
                            return False
                        # Re-qualify every 5 turns
                        if contact.conversation_turns % 5 != 0:
                            return False
                except (ValueError, TypeError):
                    pass

            # Re-qualify if meeting intent detected
            intent = event.payload.get("intent", "")
            if intent == "meeting_request":
                return True

        return True

    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute contact qualification.
        """
        result_events = []

        try:
            # Calculate qualification score and tier
            score, tier, reasoning = await self._qualify_contact(contact)

            # Update contact
            await self.blackboard.update_contact(
                contact.phone_number,
                qualification_score=score,
                qualification_tier=tier,
                qualification_data={
                    "score": score,
                    "tier": tier,
                    "reasoning": reasoning,
                    "factors": self._get_scoring_factors(contact),
                },
                qualification_updated_at=datetime.utcnow().isoformat(),
            )

            # Publish qualification.completed
            result_events.append(event.create_response(
                event_type=EventType.QUALIFICATION_COMPLETED,
                payload={
                    "score": score,
                    "tier": tier,
                    "reasoning": reasoning,
                },
                source_agent=self.name,
            ))

            # Trigger follow-up actions based on tier
            if tier in ["hot", "warm"]:
                # Request video for high-value leads
                if not contact.heygen_video_url:
                    result_events.append(event.create_response(
                        event_type=EventType.VIDEO_REQUESTED,
                        payload={"tier": tier},
                        source_agent=self.name,
                    ))

                # Request CRM sync
                result_events.append(event.create_response(
                    event_type=EventType.CRM_SYNC_NEEDED,
                    payload={"tier": tier, "score": score},
                    source_agent=self.name,
                ))

            logger.info(
                f"[{self.name}] Qualified {contact.phone_number}: "
                f"score={score}, tier={tier}"
            )

        except Exception as e:
            logger.error(f"[{self.name}] Qualification failed: {e}")

        return result_events

    async def _qualify_contact(self, contact: ContactState) -> tuple[int, str, str]:
        """
        Calculate qualification score and tier.

        Returns (score, tier, reasoning).
        """
        # Calculate base score from factors
        score = 0
        factors = []

        # Job title scoring (0-30 points)
        title_score = self._score_job_title(contact.job_title)
        score += title_score
        if title_score > 0:
            factors.append(f"Job title: +{title_score}")

        # Company scoring (0-25 points)
        company_score = self._score_company(contact)
        score += company_score
        if company_score > 0:
            factors.append(f"Company: +{company_score}")

        # Engagement scoring (0-25 points)
        engagement_score = self._score_engagement(contact)
        score += engagement_score
        if engagement_score > 0:
            factors.append(f"Engagement: +{engagement_score}")

        # Profile completeness (0-20 points)
        completeness_score = self._score_completeness(contact)
        score += completeness_score
        if completeness_score > 0:
            factors.append(f"Profile: +{completeness_score}")

        # Determine tier
        if score >= 75:
            tier = "hot"
        elif score >= 50:
            tier = "warm"
        elif score >= 25:
            tier = "cold"
        else:
            tier = "unqualified"

        reasoning = "; ".join(factors) if factors else "No qualifying factors"

        return score, tier, reasoning

    def _score_job_title(self, title: str | None) -> int:
        """Score based on job title seniority"""
        if not title:
            return 0

        title_lower = title.lower()

        # C-level executives (30 points)
        if any(x in title_lower for x in ["ceo", "cto", "cfo", "coo", "chief", "founder", "owner"]):
            return 30

        # VP/Director level (25 points)
        if any(x in title_lower for x in ["vp", "vice president", "director", "head of"]):
            return 25

        # Manager level (20 points)
        if any(x in title_lower for x in ["manager", "lead", "principal", "senior"]):
            return 20

        # Professional level (15 points)
        if any(x in title_lower for x in ["engineer", "developer", "analyst", "consultant", "specialist"]):
            return 15

        # Associate/Entry level (10 points)
        if any(x in title_lower for x in ["associate", "coordinator", "assistant"]):
            return 10

        return 5  # Unknown title

    def _score_company(self, contact: ContactState) -> int:
        """Score based on company information"""
        score = 0
        research = contact.research_data or {}

        # Company size scoring
        size = research.get("company_size", "")
        if size:
            size_lower = str(size).lower()
            if any(x in size_lower for x in ["10001", "enterprise", "large"]):
                score += 15
            elif any(x in size_lower for x in ["1001", "5001", "medium"]):
                score += 12
            elif any(x in size_lower for x in ["201", "501", "small-medium"]):
                score += 10
            elif any(x in size_lower for x in ["51", "small"]):
                score += 8
            else:
                score += 5

        # Industry scoring (tech-focused scoring example)
        industry = research.get("company_industry", "")
        if industry:
            industry_lower = industry.lower()
            if any(x in industry_lower for x in ["technology", "software", "saas", "ai", "tech"]):
                score += 10
            elif any(x in industry_lower for x in ["finance", "healthcare", "consulting"]):
                score += 8
            else:
                score += 5

        return min(score, 25)

    def _score_engagement(self, contact: ContactState) -> int:
        """Score based on engagement level"""
        score = 0

        # Conversation turns
        turns = contact.conversation_turns
        if turns >= 10:
            score += 15
        elif turns >= 5:
            score += 10
        elif turns >= 2:
            score += 5

        # Recent activity bonus
        if contact.last_message_at:
            try:
                last_msg = datetime.fromisoformat(contact.last_message_at)
                if datetime.utcnow() - last_msg < timedelta(hours=24):
                    score += 10
                elif datetime.utcnow() - last_msg < timedelta(days=7):
                    score += 5
            except (ValueError, TypeError):
                pass

        return min(score, 25)

    def _score_completeness(self, contact: ContactState) -> int:
        """Score based on profile completeness"""
        score = 0

        if contact.email:
            score += 5
        if contact.linkedin_url:
            score += 5
        if contact.first_name and contact.last_name:
            score += 3
        if contact.company_name:
            score += 4
        if contact.job_title:
            score += 3

        return min(score, 20)

    def _get_scoring_factors(self, contact: ContactState) -> dict:
        """Get detailed scoring breakdown"""
        return {
            "job_title": {
                "value": contact.job_title,
                "score": self._score_job_title(contact.job_title),
            },
            "company": {
                "name": contact.company_name,
                "score": self._score_company(contact),
            },
            "engagement": {
                "turns": contact.conversation_turns,
                "score": self._score_engagement(contact),
            },
            "completeness": {
                "has_email": bool(contact.email),
                "has_linkedin": bool(contact.linkedin_url),
                "has_name": bool(contact.first_name),
                "score": self._score_completeness(contact),
            },
        }
