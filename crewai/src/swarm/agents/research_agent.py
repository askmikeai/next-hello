"""
Research Agent - Autonomous contact enrichment

Subscribes to: contact.created, contact.updated
Publishes: research.completed, research.failed, qualification.needed
"""

import os
import logging
import json
from typing import List
from datetime import datetime

import httpx

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..eventbus import EventBus
from ..blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)


class ResearchAgent(AutonomousAgent):
    """
    Autonomous agent for contact research and enrichment.

    Uses People Data Labs to enrich contact profiles with:
    - Job title and company information
    - Work history and education
    - Skills and experience
    - LinkedIn profile

    Autonomy logic:
    - Only acts if contact has email or LinkedIn URL
    - Skips if research already complete or in progress
    - Publishes qualification.needed after successful research
    """

    @property
    def name(self) -> str:
        return "research"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [
            EventType.CONTACT_CREATED,
            EventType.CONTACT_UPDATED,
            EventType.RESEARCH_NEEDED,
        ]

    async def should_act(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> bool:
        """
        Decide if we should research this contact.

        Conditions for acting:
        1. Research not already complete
        2. Research not already in progress
        3. Contact has email OR LinkedIn URL
        """
        # Skip if research already done
        if contact.research_status == "complete":
            logger.debug(f"[{self.name}] Skipping - research already complete")
            return False

        # Skip if research in progress
        if contact.research_status == "in_progress":
            logger.debug(f"[{self.name}] Skipping - research in progress")
            return False

        # Need at least email or LinkedIn to research
        if not (contact.email or contact.linkedin_url):
            logger.debug(f"[{self.name}] Skipping - no email or LinkedIn")
            return False

        # For contact.updated events, only act if we got new research-worthy info
        if event.event_type == EventType.CONTACT_UPDATED:
            updated_fields = event.payload.get("updated_fields", [])
            if not any(f in updated_fields for f in ["email", "linkedin_url"]):
                return False

        return True

    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute contact research using PDL.
        """
        result_events = []

        # Mark research as in progress
        await self.blackboard.update_contact(
            contact.phone_number,
            research_status="in_progress",
        )

        try:
            # Call PDL API
            research_data = await self._enrich_contact(contact)

            if research_data:
                # Update contact with enrichment data
                updates = {
                    "research_status": "complete",
                    "research_data": research_data,
                    "research_completed_at": datetime.utcnow().isoformat(),
                }

                # Update fields if PDL provided better data
                if research_data.get("first_name") and not contact.first_name:
                    updates["first_name"] = research_data["first_name"]
                if research_data.get("last_name") and not contact.last_name:
                    updates["last_name"] = research_data["last_name"]
                if research_data.get("job_title") and not contact.job_title:
                    updates["job_title"] = research_data["job_title"]
                if research_data.get("company_name") and not contact.company_name:
                    updates["company_name"] = research_data["company_name"]
                if research_data.get("linkedin_url") and not contact.linkedin_url:
                    updates["linkedin_url"] = research_data["linkedin_url"]

                await self.blackboard.update_contact(contact.phone_number, **updates)

                # Publish research.completed
                result_events.append(event.create_response(
                    event_type=EventType.RESEARCH_COMPLETED,
                    payload={
                        "research_data": research_data,
                        "source": "pdl",
                    },
                    source_agent=self.name,
                ))

                # Trigger qualification
                result_events.append(event.create_response(
                    event_type=EventType.QUALIFICATION_NEEDED,
                    payload={},
                    source_agent=self.name,
                ))

                logger.info(f"[{self.name}] Research completed for {contact.phone_number}")

            else:
                # No data found
                await self.blackboard.update_contact(
                    contact.phone_number,
                    research_status="failed",
                )

                result_events.append(event.create_response(
                    event_type=EventType.RESEARCH_FAILED,
                    payload={"reason": "no_data_found"},
                    source_agent=self.name,
                ))

        except Exception as e:
            logger.error(f"[{self.name}] Research failed: {e}")

            await self.blackboard.update_contact(
                contact.phone_number,
                research_status="failed",
            )

            result_events.append(event.create_response(
                event_type=EventType.RESEARCH_FAILED,
                payload={"reason": str(e)},
                source_agent=self.name,
            ))

        return result_events

    async def _enrich_contact(self, contact: ContactState) -> dict | None:
        """
        Call PDL API to enrich contact.

        Returns enrichment data or None if no match found.
        """
        api_key = os.getenv("PDL_API_KEY")
        if not api_key:
            logger.warning("PDL_API_KEY not configured")
            return None

        # Build query parameters
        params = {"api_key": api_key, "pretty": "true"}

        if contact.email:
            params["email"] = contact.email
        if contact.linkedin_url:
            params["profile"] = contact.linkedin_url
        if contact.first_name:
            params["first_name"] = contact.first_name
        if contact.last_name:
            params["last_name"] = contact.last_name
        if contact.company_name:
            params["company"] = contact.company_name

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(
                    "https://api.peopledatalabs.com/v5/person/enrich",
                    params=params,
                )

                if response.status_code == 404:
                    logger.info(f"[{self.name}] No PDL match for {contact.phone_number}")
                    return None

                if response.status_code != 200:
                    logger.error(f"[{self.name}] PDL error: {response.status_code}")
                    return None

                data = response.json()

                # Extract relevant fields
                result = {
                    "full_name": data.get("full_name"),
                    "first_name": data.get("first_name"),
                    "last_name": data.get("last_name"),
                    "job_title": data.get("job_title"),
                    "company_name": data.get("job_company_name"),
                    "company_industry": data.get("job_company_industry"),
                    "company_size": data.get("job_company_size"),
                    "linkedin_url": data.get("linkedin_url"),
                    "work_email": data.get("work_email"),
                    "location": self._format_location(data),
                    "skills": data.get("skills", [])[:10],
                    "experience_years": self._calculate_experience(data),
                }

                # Extract education
                education = data.get("education", [])
                if education:
                    result["education"] = [
                        {
                            "school": edu.get("school", {}).get("name"),
                            "degree": edu.get("degrees", [None])[0] if edu.get("degrees") else None,
                            "field": edu.get("majors", [None])[0] if edu.get("majors") else None,
                        }
                        for edu in education[:3]
                    ]

                # Extract work history
                experience = data.get("experience", [])
                if experience:
                    result["work_history"] = [
                        {
                            "title": exp.get("title", {}).get("name") if isinstance(exp.get("title"), dict) else exp.get("title"),
                            "company": exp.get("company", {}).get("name") if isinstance(exp.get("company"), dict) else exp.get("company"),
                            "start_date": exp.get("start_date"),
                            "end_date": exp.get("end_date"),
                        }
                        for exp in experience[:3]
                    ]

                return result

        except httpx.TimeoutException:
            logger.error(f"[{self.name}] PDL request timed out")
            return None
        except Exception as e:
            logger.error(f"[{self.name}] PDL error: {e}")
            return None

    def _format_location(self, data: dict) -> str | None:
        """Format location from PDL data"""
        parts = []
        if data.get("location_locality"):
            parts.append(data["location_locality"])
        if data.get("location_region"):
            parts.append(data["location_region"])
        if data.get("location_country"):
            parts.append(data["location_country"])
        return ", ".join(parts) if parts else None

    def _calculate_experience(self, data: dict) -> int | None:
        """Calculate years of experience from work history"""
        experience = data.get("experience", [])
        if not experience:
            return None

        earliest_year = None
        for exp in experience:
            start = exp.get("start_date")
            if start:
                try:
                    year = int(start.split("-")[0])
                    if earliest_year is None or year < earliest_year:
                        earliest_year = year
                except (ValueError, IndexError):
                    continue

        if earliest_year:
            return datetime.now().year - earliest_year

        return None
