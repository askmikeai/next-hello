"""
Personalization Agent - Message and content generation

Subscribes to: message.received, qualification.completed
Publishes: message.send, video.script_ready
"""

import os
import logging
from typing import List

from crewai import Agent, Task, Crew, LLM

from ..agent_runner import AutonomousAgent
from ..events import SwarmEvent, EventType
from ..eventbus import EventBus
from ..blackboard import Blackboard, ContactState

logger = logging.getLogger(__name__)


class PersonalizationAgent(AutonomousAgent):
    """
    Autonomous agent for personalized content generation.

    Generates:
    - Contextual message responses
    - Video scripts for qualified leads
    - Welcome messages for new contacts

    Uses LLM for natural, personalized content.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._llm = None
        # These are process-level defaults; per-owner values are loaded at
        # execution time via OwnerConfig and override these.
        self._owner_name = os.getenv("OWNER_NAME", "")
        self._owner_role = os.getenv("OWNER_ROLE", "")
        self._owner_location = os.getenv("OWNER_LOCATION", "")
        self._owner_interests = os.getenv("OWNER_INTERESTS", "")
        self._owner_favorite_place = os.getenv("OWNER_FAVORITE_PLACE", "")
        self._event_name = os.getenv("EVENT_NAME", "")
        self._calendly_url = os.getenv("CALENDLY_URL", "")

    async def _load_identity(self, owner_id: str) -> None:
        """Refresh identity fields from per-owner DB config."""
        cfg = await self.get_owner_config(owner_id)
        ident = cfg.identity
        self._owner_name = ident.get("owner_name") or self._owner_name
        self._owner_role = ident.get("owner_role") or self._owner_role
        self._owner_location = ident.get("owner_location") or self._owner_location
        self._owner_interests = ident.get("owner_interests") or self._owner_interests
        self._owner_favorite_place = ident.get("owner_favorite_place") or self._owner_favorite_place
        self._event_name = ident.get("event_name") or self._event_name
        self._calendly_url = ident.get("calendly_url") or self._calendly_url

        # LLM provider can also be per-owner
        llm_cfg = cfg.llm
        anthropic_key = llm_cfg.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY", "")
        openai_key = llm_cfg.get("openai_api_key") or os.getenv("OPENAI_API_KEY", "")
        primary = llm_cfg.get("primary_provider") or "anthropic/claude-sonnet-4-20250514"

        # Rebuild LLMs based on per-owner config
        if primary.startswith("anthropic/") and anthropic_key:
            self._llm = LLM(model=primary, max_tokens=1024, temperature=0.8)
        elif openai_key:
            self._llm = LLM(model=primary, temperature=0.8)
        else:
            self._llm = LLM(
                model="anthropic/claude-sonnet-4-20250514", max_tokens=1024, temperature=0.8
            )

        if not hasattr(self, "_fallback_llm"):
            self._fallback_llm = None
        if openai_key and primary.startswith("anthropic/"):
            self._fallback_llm = LLM(model="openai/gpt-4o", temperature=0.8)
        elif anthropic_key and not primary.startswith("anthropic/"):
            self._fallback_llm = LLM(
                model="anthropic/claude-sonnet-4-20250514", max_tokens=1024, temperature=0.8
            )
        else:
            self._fallback_llm = None

    @property
    def llm(self) -> LLM:
        """Get primary LLM — Anthropic first."""
        if self._llm is None:
            self._llm = LLM(
                model="anthropic/claude-sonnet-4-20250514",
                max_tokens=1024,
                temperature=0.8,
            )
        return self._llm

    @property
    def fallback_llm(self) -> LLM | None:
        """Get OpenAI fallback LLM when Anthropic fails."""
        if not hasattr(self, "_fallback_llm"):
            openai_key = os.getenv("OPENAI_API_KEY", "")
            if openai_key:
                llm_provider = os.getenv("LLM_PROVIDER", "openai/gpt-4o")
                self._fallback_llm = LLM(model=llm_provider, temperature=0.8)
            else:
                self._fallback_llm = None
        return self._fallback_llm

    @property
    def name(self) -> str:
        return "personalization"

    @property
    def subscribed_events(self) -> List[EventType]:
        return [
            EventType.MESSAGE_RECEIVED,
            EventType.QUALIFICATION_COMPLETED,
            EventType.VIDEO_REQUESTED,
        ]

    async def should_act(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> bool:
        """
        Decide if we should generate content.

        Conditions for acting:
        - message.received: Generate response for questions/discussions
        - qualification.completed: Generate follow-up based on tier
        - video.requested: Generate video script
        """
        # For messages, respond to questions and discussions
        if event.event_type == EventType.MESSAGE_RECEIVED:
            intent = event.payload.get("intent", "")
            message_type = str(event.payload.get("message_type", "text")).lower()

            # Always respond to voice notes.
            if message_type == "audio":
                return True

            # Skip greetings only for brand-new contacts (coordinator sends welcome)
            if intent == "greeting" and not contact.welcomed:
                return False

            # For already-welcomed contacts, respond to everything including greetings
            if contact.welcomed:
                return True

            # Generate response for questions and discussions
            if intent in ["question", "general", "introduction", "meeting_request"]:
                return True
            return False

        # For qualification, generate follow-up for hot/warm leads
        if event.event_type == EventType.QUALIFICATION_COMPLETED:
            tier = event.payload.get("tier", "")
            if tier in ["hot", "warm"]:
                return True
            return False

        # Always generate video scripts when requested
        if event.event_type == EventType.VIDEO_REQUESTED:
            return True

        return False

    async def execute(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> List[SwarmEvent]:
        """
        Execute content generation.
        """
        await self._load_identity(event.owner_id)
        result_events = []

        try:
            if event.event_type == EventType.MESSAGE_RECEIVED:
                response = await self._generate_message_response(event, contact)
                if response:
                    result_events.append(
                        event.create_response(
                            event_type=EventType.MESSAGE_SEND,
                            payload={
                                "text": response,
                                "message_type": "text",
                            },
                            source_agent=self.name,
                        )
                    )

                    # If contact prefers voice, request voice generation too.
                    if contact.voice_mode:
                        result_events.append(
                            event.create_response(
                                event_type=EventType.VOICE_REQUESTED,
                                payload={"script": response},
                                source_agent=self.name,
                            )
                        )

            elif event.event_type == EventType.QUALIFICATION_COMPLETED:
                response = await self._generate_qualification_followup(event, contact)
                if response:
                    result_events.append(
                        event.create_response(
                            event_type=EventType.MESSAGE_SEND,
                            payload={
                                "text": response,
                                "message_type": "text",
                            },
                            source_agent=self.name,
                        )
                    )

            elif event.event_type == EventType.VIDEO_REQUESTED:
                script = await self._generate_video_script(contact)
                if script:
                    # Update contact with script
                    await self.blackboard.update_contact(
                        contact.phone_number,
                        owner_id=event.owner_id,
                        video_script=script,
                    )

                    result_events.append(
                        event.create_response(
                            event_type=EventType.VIDEO_SCRIPT_READY,
                            payload={"script": script},
                            source_agent=self.name,
                        )
                    )

            logger.info(f"[{self.name}] Generated content for {contact.phone_number}")

        except Exception as e:
            logger.error(f"[{self.name}] Content generation failed: {e}")

        return result_events

    async def _generate_message_response(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> str | None:
        """Generate a response to an incoming message"""
        message_text = event.payload.get("text", "")
        intent = event.payload.get("intent", "general")
        message_type = str(event.payload.get("message_type", "text")).lower()

        if message_type == "audio" and not str(message_text).strip():
            name = contact.first_name or contact.push_name or "there"
            return (
                f"Thanks for your voice note, {name}. I heard you and I am happy to help. "
                "What should we focus on first?"
            )

        # Build context about the contact
        contact_context = self._build_contact_context(contact)

        # Handle meeting requests specially
        if intent == "meeting_request":
            name = contact.first_name or contact.push_name or "you"
            if self._calendly_url:
                return (
                    f"I'd love to chat more, {name}! Here's my calendar link to "
                    f"find a time that works: {self._calendly_url}"
                )
            else:
                return (
                    f"I'd love to connect, {name}! Let me know what times work "
                    "for you this week and I'll send over a calendar invite."
                )

        # Use LLM for other responses
        agent = Agent(
            role="Networking Assistant",
            goal=f"Help {self._owner_name} have engaging conversations",
            backstory=(
                f"You are {self._owner_name}'s friendly networking assistant at {self._event_name}. "
                f"{self._owner_name} is an {self._owner_role} based in {self._owner_location}. "
                f"Interests: {self._owner_interests}. Favorite place: {self._owner_favorite_place}. "
                "You help have warm, professional conversations that build genuine connections. "
                "Keep responses concise (2-3 sentences) and conversational."
            ),
            llm=self.llm,
            verbose=False,
        )

        task = Task(
            description=f"""
            Generate a friendly response to this message from {contact.first_name or "the contact"}:

            Message: {message_text}

            Context about the person:
            {contact_context}

            Guidelines:
            - Be warm and professional
            - Keep it to 2-3 sentences
            - If they ask about {self._owner_name}, mention they are an {self._owner_role}
            - Reference their background if relevant
            - Gently try to move toward booking a quick call when it feels natural
            - Ask a thoughtful follow-up question when appropriate
            """,
            expected_output="A friendly, personalized response",
            agent=agent,
        )

        crew = Crew(agents=[agent], tasks=[task], verbose=False)
        try:
            result = crew.kickoff()
            return self._maybe_add_calendly_cta(str(result), contact)
        except Exception as primary_err:
            logger.warning(f"[{self.name}] Anthropic primary LLM failed: {primary_err}")

            # Retry with OpenAI fallback if available
            if self.fallback_llm:
                try:
                    logger.info(f"[{self.name}] Retrying with OpenAI fallback LLM")
                    fallback_agent = Agent(
                        role=agent.role,
                        goal=agent.goal,
                        backstory=agent.backstory,
                        llm=self.fallback_llm,
                        verbose=False,
                    )
                    fallback_task = Task(
                        description=task.description,
                        expected_output=task.expected_output,
                        agent=fallback_agent,
                    )
                    fallback_crew = Crew(
                        agents=[fallback_agent], tasks=[fallback_task], verbose=False
                    )
                    result = fallback_crew.kickoff()
                    return self._maybe_add_calendly_cta(str(result), contact)
                except Exception as fallback_err:
                    logger.warning(f"[{self.name}] OpenAI fallback also failed: {fallback_err}")

            name = contact.first_name or contact.push_name or "there"
            fallback = (
                f"Thanks for the message, {name}. I ran into a temporary issue on my side, "
                "but I am here and can still help. Can you share a bit more detail so I can assist?"
            )
            return self._maybe_add_calendly_cta(fallback, contact)

    def _maybe_add_calendly_cta(self, response: str, contact: ContactState) -> str:
        """Append a light calendly CTA when available and not already present."""
        text = (response or "").strip()
        if not text:
            return text
        if not self._calendly_url:
            return text
        if self._calendly_url in text:
            return text

        # Avoid repeating the CTA every turn.
        if (contact.conversation_turns or 0) > 4:
            return text

        return f"{text} If helpful, you can grab a quick time here: {self._calendly_url}"

    async def _generate_qualification_followup(
        self,
        event: SwarmEvent,
        contact: ContactState,
    ) -> str | None:
        """Generate follow-up message after qualification"""
        tier = event.payload.get("tier", "")

        # Only send follow-up if there's research data to reference
        if not contact.research_data:
            return None

        name = contact.first_name or contact.push_name or "there"
        research = contact.research_data or {}

        # Build a personalized follow-up based on research
        company = research.get("company_name") or contact.company_name
        title = research.get("job_title") or contact.job_title
        skills = research.get("skills", [])[:3]

        if company and title:
            opening = (
                f"I was looking at your background, {name} - {title} at {company} is impressive!"
            )
        elif company:
            opening = f"I was looking into {company}, {name} - really interesting work!"
        elif title:
            opening = f"I noticed you're a {title}, {name} - that's a great role!"
        else:
            return None  # Not enough info for meaningful follow-up

        if skills:
            skill_mention = f" Your expertise in {skills[0]} caught my attention."
        else:
            skill_mention = ""

        # Add call to action based on tier
        if tier == "hot" and self._calendly_url:
            cta = f" Would love to connect further - here's my calendar: {self._calendly_url}"
        else:
            cta = " I'd love to hear more about what you're working on."

        return f"{opening}{skill_mention}{cta}"

    async def _generate_video_script(self, contact: ContactState) -> str | None:
        """Generate a personalized video script"""
        name = contact.first_name or contact.push_name or "there"
        company = contact.company_name
        title = contact.job_title
        research = contact.research_data or {}

        # Build personalization points
        personalization = []
        if company:
            personalization.append(f"company: {company}")
        if title:
            personalization.append(f"role: {title}")
        if research.get("skills"):
            personalization.append(f"skills: {', '.join(research['skills'][:3])}")

        agent = Agent(
            role="Video Script Writer",
            goal="Write engaging, personalized video scripts",
            backstory=(
                f"You write short, authentic video scripts for {self._owner_name}. "
                "The videos should feel personal and genuine, not salesy. "
                "Keep scripts to 30-45 seconds when spoken."
            ),
            llm=self.llm,
            verbose=False,
        )

        task = Task(
            description=f"""
            Write a personalized video script for {self._owner_name} to record for {name}.

            Personalization details:
            {chr(10).join(personalization) if personalization else "Limited information available"}

            Guidelines:
            - Address them by name
            - Reference something specific about their background
            - Keep it under 100 words (30-45 seconds when spoken)
            - End with a soft call to action (connect, chat, etc.)
            - Sound natural and authentic, not corporate
            - Use natural speech patterns
            """,
            expected_output="A video script in plain text format",
            agent=agent,
        )

        crew = Crew(agents=[agent], tasks=[task], verbose=False)
        try:
            result = crew.kickoff()
            return str(result)
        except Exception as primary_err:
            logger.warning(
                f"[{self.name}] Anthropic primary LLM failed for video script: {primary_err}"
            )

            if self.fallback_llm:
                try:
                    logger.info(f"[{self.name}] Retrying video script with OpenAI fallback LLM")
                    fallback_agent = Agent(
                        role=agent.role,
                        goal=agent.goal,
                        backstory=agent.backstory,
                        llm=self.fallback_llm,
                        verbose=False,
                    )
                    fallback_task = Task(
                        description=task.description,
                        expected_output=task.expected_output,
                        agent=fallback_agent,
                    )
                    fallback_crew = Crew(
                        agents=[fallback_agent], tasks=[fallback_task], verbose=False
                    )
                    result = fallback_crew.kickoff()
                    return str(result)
                except Exception as fallback_err:
                    logger.warning(
                        f"[{self.name}] OpenAI fallback also failed for video script: {fallback_err}"
                    )

            return None

    def _build_contact_context(self, contact: ContactState) -> str:
        """Build context string about a contact"""
        lines = []

        if contact.first_name:
            lines.append(f"Name: {contact.first_name} {contact.last_name or ''}")
        if contact.company_name:
            lines.append(f"Company: {contact.company_name}")
        if contact.job_title:
            lines.append(f"Title: {contact.job_title}")

        research = contact.research_data or {}
        if research.get("skills"):
            lines.append(f"Skills: {', '.join(research['skills'][:5])}")
        if research.get("company_industry"):
            lines.append(f"Industry: {research['company_industry']}")

        if contact.qualification_tier:
            lines.append(f"Qualification: {contact.qualification_tier} lead")

        lines.append(f"Conversation turns: {contact.conversation_turns}")

        return "\n".join(lines) if lines else "No additional context available."
