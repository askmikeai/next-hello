"""
Conversation Orchestrator

Processes incoming messages and coordinates agent responses.
This replaces the TypeScript swarm orchestrator with a CrewAI-based approach.
"""

import os
import logging
import re
from typing import Optional
from dataclasses import dataclass
from enum import Enum

from crewai import Agent, Task, Crew, LLM

from ..state import RedisStateManager, ConversationState
from ..crews import NetworkingCrew

logger = logging.getLogger(__name__)


class Intent(str, Enum):
    """Detected user intent"""

    GREETING = "greeting"
    INTRODUCTION = "introduction"
    QUESTION = "question"
    MEETING_REQUEST = "meeting_request"
    CONTACT_INFO = "contact_info"
    FOLLOW_UP = "follow_up"
    THANK_YOU = "thank_you"
    GOODBYE = "goodbye"
    UNKNOWN = "unknown"


@dataclass
class MessageContext:
    """Context for processing a message"""

    phone_number: str
    message_text: str
    message_type: str
    push_name: Optional[str]
    state: ConversationState
    detected_intent: Intent
    extracted_entities: dict


class ConversationOrchestrator:
    """
    Orchestrates conversation flow using CrewAI agents.

    The orchestrator:
    1. Analyzes incoming messages to detect intent
    2. Extracts relevant entities (email, name, company)
    3. Routes to appropriate agents based on context
    4. Generates personalized responses
    5. Triggers background tasks (research, video, etc.)
    """

    def __init__(
        self,
        state_manager: RedisStateManager,
        crew: Optional[NetworkingCrew] = None,
        llm_provider: Optional[str] = None,
    ):
        self.state_manager = state_manager
        self.llm_provider = llm_provider or os.getenv(
            "LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514"
        )
        self._crew = crew
        self._llm: Optional[LLM] = None

    @property
    def crew(self) -> NetworkingCrew:
        """Lazy-load the crew"""
        if self._crew is None:
            self._crew = NetworkingCrew(
                llm_provider=self.llm_provider,
                owner_name=os.getenv("OWNER_NAME", "the host"),
                event_name=os.getenv("EVENT_NAME", "the event"),
            )
        return self._crew

    @property
    def llm(self) -> LLM:
        """Get LLM instance for quick tasks"""
        if self._llm is None:
            if self.llm_provider.startswith("anthropic/"):
                self._llm = LLM(
                    model=self.llm_provider,
                    max_tokens=1024,
                    temperature=0.7,
                )
            else:
                self._llm = LLM(
                    model=self.llm_provider,
                    temperature=0.7,
                )
        return self._llm

    async def process_message(
        self,
        phone_number: str,
        message_text: str,
        message_type: str = "text",
        push_name: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> str:
        """
        Process an incoming message and generate a response.

        Args:
            phone_number: The sender's phone number
            message_text: The message content
            message_type: Type of message (text, audio, image, etc.)
            push_name: WhatsApp display name
            message_id: WhatsApp message ID

        Returns:
            Response text to send back
        """
        logger.info(f"Processing message from {phone_number}: {message_text[:50]}...")

        # Get or create conversation state
        state = await self.state_manager.get_state(phone_number)
        if not state:
            state = ConversationState(
                phone_number=phone_number,
                push_name=push_name,
            )
            await self.state_manager.save_state(state)

        # Update push_name if available
        if push_name and not state.push_name:
            state.push_name = push_name
            await self.state_manager.save_state(state)

        # Detect intent and extract entities
        intent = self._detect_intent(message_text, state)
        entities = self._extract_entities(message_text)

        # Update state with extracted info
        await self._update_state_from_entities(state, entities)

        # Create context
        context = MessageContext(
            phone_number=phone_number,
            message_text=message_text,
            message_type=message_type,
            push_name=push_name,
            state=state,
            detected_intent=intent,
            extracted_entities=entities,
        )

        # Route based on intent and state
        response = await self._route_and_respond(context)

        # Track the message
        if message_id:
            await self.state_manager.add_message(
                phone_number,
                message_id,
                "incoming",
                message_type,
                message_text,
            )

        return response

    def _detect_intent(self, message: str, state: ConversationState) -> Intent:
        """
        Detect the user's intent from their message.

        Uses pattern matching for common intents, with context awareness.
        """
        message_lower = message.lower().strip()

        # Greeting patterns
        greeting_patterns = [
            r"^(hi|hello|hey|howdy|hola|greetings)",
            r"^good (morning|afternoon|evening)",
            r"^what'?s up",
        ]
        for pattern in greeting_patterns:
            if re.search(pattern, message_lower):
                return Intent.GREETING

        # Introduction patterns
        intro_patterns = [
            r"(my name is|i'?m |i am )\w+",
            r"(i work at|i'?m from|i'?m with)\s+\w+",
            r"(i'?m a|i am a)\s+\w+",  # "I'm a developer"
        ]
        for pattern in intro_patterns:
            if re.search(pattern, message_lower):
                return Intent.INTRODUCTION

        # Meeting request patterns
        meeting_patterns = [
            r"(let'?s|can we|want to|would like to)\s+(meet|chat|talk|connect|schedule|book)",
            r"(schedule|book|set up)\s+(a )?(call|meeting|time)",
            r"calendly",
            r"when (are you|can you|should we)",
        ]
        for pattern in meeting_patterns:
            if re.search(pattern, message_lower):
                return Intent.MEETING_REQUEST

        # Contact info patterns
        contact_patterns = [
            r"(my email|email me|reach me|contact me)",
            r"(here'?s|this is) my (email|number|linkedin)",
            r"@\w+\.\w+",  # Email pattern
            r"linkedin\.com",
        ]
        for pattern in contact_patterns:
            if re.search(pattern, message_lower):
                return Intent.CONTACT_INFO

        # Thank you patterns
        thanks_patterns = [
            r"^(thanks|thank you|thx|ty)",
            r"(appreciate|grateful)",
        ]
        for pattern in thanks_patterns:
            if re.search(pattern, message_lower):
                return Intent.THANK_YOU

        # Goodbye patterns
        bye_patterns = [
            r"^(bye|goodbye|see you|take care|later)",
            r"(got to go|have to go|nice meeting)",
        ]
        for pattern in bye_patterns:
            if re.search(pattern, message_lower):
                return Intent.GOODBYE

        # Question patterns
        question_patterns = [
            r"\?$",
            r"^(what|who|where|when|why|how|can|do|does|is|are|will|would)",
        ]
        for pattern in question_patterns:
            if re.search(pattern, message_lower):
                return Intent.QUESTION

        # If we've had previous turns, likely a follow-up
        if state.conversation_turns > 0:
            return Intent.FOLLOW_UP

        return Intent.UNKNOWN

    def _extract_entities(self, message: str) -> dict:
        """
        Extract relevant entities from the message.
        """
        entities = {}

        # Email extraction
        email_pattern = r"[\w\.-]+@[\w\.-]+\.\w+"
        email_match = re.search(email_pattern, message)
        if email_match:
            entities["email"] = email_match.group()

        # LinkedIn URL
        linkedin_pattern = r"linkedin\.com/in/[\w\-]+"
        linkedin_match = re.search(linkedin_pattern, message.lower())
        if linkedin_match:
            entities["linkedin_url"] = f"https://www.{linkedin_match.group()}"

        # Name extraction (basic - "I'm John" or "My name is John Smith")
        name_patterns = [
            r"(?:my name is|i'?m|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
            r"(?:this is|it'?s)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
        ]
        for pattern in name_patterns:
            name_match = re.search(pattern, message, re.IGNORECASE)
            if name_match:
                full_name = name_match.group(1).strip()
                parts = full_name.split()
                entities["first_name"] = parts[0]
                if len(parts) > 1:
                    entities["last_name"] = " ".join(parts[1:])
                break

        # Company extraction
        company_patterns = [
            r"(?:i work at|i'?m (?:from|with)|at)\s+([A-Z][\w\s&]+?)(?:\.|,|$|\s+(?:as|and))",
            r"(?:company|organization|firm)(?:\s+is)?\s+([A-Z][\w\s&]+?)(?:\.|,|$)",
        ]
        for pattern in company_patterns:
            company_match = re.search(pattern, message, re.IGNORECASE)
            if company_match:
                entities["company_name"] = company_match.group(1).strip()
                break

        # Job title extraction
        title_patterns = [
            r"(?:i'?m a|i am a|work as a?|my role is)\s+([A-Za-z\s]+?)(?:\.|,|$|\s+at)",
        ]
        for pattern in title_patterns:
            title_match = re.search(pattern, message, re.IGNORECASE)
            if title_match:
                entities["job_title"] = title_match.group(1).strip()
                break

        return entities

    async def _update_state_from_entities(
        self,
        state: ConversationState,
        entities: dict,
    ) -> None:
        """Update conversation state with extracted entities"""
        updated = False

        if "email" in entities and not state.email:
            state.email = entities["email"]
            updated = True

        if "linkedin_url" in entities and not state.linkedin_url:
            state.linkedin_url = entities["linkedin_url"]
            updated = True

        if "first_name" in entities and not state.first_name:
            state.first_name = entities["first_name"]
            updated = True

        if "last_name" in entities and not state.last_name:
            state.last_name = entities["last_name"]
            updated = True

        if "company_name" in entities and not state.company_name:
            state.company_name = entities["company_name"]
            updated = True

        if "job_title" in entities and not state.job_title:
            state.job_title = entities["job_title"]
            updated = True

        if updated:
            await self.state_manager.save_state(state)
            logger.info(f"Updated state for {state.phone_number} with entities: {entities}")

    async def _route_and_respond(self, context: MessageContext) -> str:
        """
        Route the message based on intent and generate response.
        """
        intent = context.detected_intent
        state = context.state

        # First message - welcome them
        if state.conversation_turns == 0:
            return await self._handle_first_message(context)

        # Route based on intent
        if intent == Intent.GREETING:
            return await self._handle_greeting(context)

        elif intent == Intent.INTRODUCTION:
            return await self._handle_introduction(context)

        elif intent == Intent.MEETING_REQUEST:
            return await self._handle_meeting_request(context)

        elif intent == Intent.CONTACT_INFO:
            return await self._handle_contact_info(context)

        elif intent == Intent.QUESTION:
            return await self._handle_question(context)

        elif intent == Intent.THANK_YOU:
            return await self._handle_thank_you(context)

        elif intent == Intent.GOODBYE:
            return await self._handle_goodbye(context)

        else:
            return await self._handle_general(context)

    async def _handle_first_message(self, context: MessageContext) -> str:
        """Handle the first message from a new contact"""
        name = context.push_name or context.state.first_name or "there"

        # Use personalization agent for welcome
        response = self.crew.generate_welcome_message(
            first_name=name,
            company_name=context.state.company_name,
            job_title=context.state.job_title,
        )

        # Trigger background research if we have any info
        if context.extracted_entities.get("email") or context.extracted_entities.get("linkedin_url"):
            await self._trigger_research(context)

        return str(response)

    async def _handle_greeting(self, context: MessageContext) -> str:
        """Handle a greeting"""
        name = context.push_name or context.state.first_name or "there"
        owner = os.getenv("OWNER_NAME", "I")

        responses = [
            f"Hey {name}! Great to hear from you again. How can I help?",
            f"Hi {name}! What's on your mind?",
            f"Hello again, {name}! {owner} here. How can I assist you today?",
        ]

        # Simple rotation based on conversation turns
        return responses[context.state.conversation_turns % len(responses)]

    async def _handle_introduction(self, context: MessageContext) -> str:
        """Handle when someone introduces themselves"""
        entities = context.extracted_entities

        name = entities.get("first_name") or context.push_name or "you"
        company = entities.get("company_name")
        title = entities.get("job_title")

        if company and title:
            response = f"Great to meet you, {name}! {title} at {company} - that's impressive. "
        elif company:
            response = f"Nice to meet you, {name}! {company} sounds like an interesting company. "
        elif title:
            response = f"Pleasure to meet you, {name}! {title} - that sounds like a great role. "
        else:
            response = f"Great to meet you, {name}! "

        response += "I'd love to learn more about what you do. What brings you to this event?"

        # Trigger research
        await self._trigger_research(context)

        return response

    async def _handle_meeting_request(self, context: MessageContext) -> str:
        """Handle meeting request"""
        name = context.push_name or context.state.first_name or "you"

        # Mark calendly sent
        context.state.calendly_sent = True
        await self.state_manager.save_state(context.state)

        calendly_url = os.getenv("CALENDLY_URL", "")
        if calendly_url:
            return (
                f"I'd love to chat more, {name}! Here's my calendar link to find a time that works: "
                f"{calendly_url}"
            )
        else:
            return (
                f"I'd love to connect, {name}! Let me know what times work for you this week "
                "and I'll send over a calendar invite."
            )

    async def _handle_contact_info(self, context: MessageContext) -> str:
        """Handle when someone shares contact info"""
        entities = context.extracted_entities
        name = context.push_name or context.state.first_name or "you"

        if entities.get("email"):
            # Trigger research with the email
            await self._trigger_research(context)
            return (
                f"Thanks for sharing that, {name}! I'll keep your contact info handy. "
                "Is there anything specific you'd like to discuss?"
            )

        if entities.get("linkedin_url"):
            await self._trigger_research(context)
            return (
                f"Thanks {name}! I'll check out your LinkedIn. "
                "What would you like to chat about?"
            )

        return f"Thanks for sharing, {name}! Let me know if there's anything I can help with."

    async def _handle_question(self, context: MessageContext) -> str:
        """Handle questions - use the LLM for a contextual response"""
        # For questions, we use the personalization agent to generate
        # a contextual response based on the user's profile

        name = context.push_name or context.state.first_name or "there"
        owner = os.getenv("OWNER_NAME", "Michael")
        event = os.getenv("EVENT_NAME", "the event")

        # Create a quick response agent
        agent = Agent(
            role="Networking Assistant",
            goal=f"Help {owner} have great conversations at {event}",
            backstory=f"You are {owner}'s friendly networking assistant. You help answer questions concisely and warmly.",
            llm=self.llm,
            verbose=False,
        )

        # Build context
        contact_info = ""
        if context.state.first_name:
            contact_info += f"Name: {context.state.first_name}"
            if context.state.last_name:
                contact_info += f" {context.state.last_name}"
            contact_info += "\n"
        if context.state.company_name:
            contact_info += f"Company: {context.state.company_name}\n"
        if context.state.job_title:
            contact_info += f"Title: {context.state.job_title}\n"

        task = Task(
            description=f"""
            Answer this question from {name} in a friendly, helpful way:

            Question: {context.message_text}

            Context about the person:
            {contact_info if contact_info else "No additional context available."}

            Keep your response concise (2-3 sentences) and conversational.
            If you don't know something, be honest about it.
            """,
            expected_output="A friendly, concise response",
            agent=agent,
        )

        crew = Crew(agents=[agent], tasks=[task], verbose=False)
        result = crew.kickoff()

        return str(result)

    async def _handle_thank_you(self, context: MessageContext) -> str:
        """Handle thank you messages"""
        name = context.push_name or context.state.first_name or "you"

        responses = [
            f"You're welcome, {name}! Let me know if there's anything else I can help with.",
            f"Happy to help, {name}! Don't hesitate to reach out anytime.",
            f"Of course, {name}! It was great chatting with you.",
        ]

        return responses[context.state.conversation_turns % len(responses)]

    async def _handle_goodbye(self, context: MessageContext) -> str:
        """Handle goodbye messages"""
        name = context.push_name or context.state.first_name or ""

        if name:
            return f"Great meeting you, {name}! Looking forward to staying in touch. Take care!"
        else:
            return "Great meeting you! Looking forward to staying in touch. Take care!"

    async def _handle_general(self, context: MessageContext) -> str:
        """Handle general messages"""
        # For general messages, use the question handler logic
        return await self._handle_question(context)

    async def _trigger_research(self, context: MessageContext) -> None:
        """Trigger background research on the contact"""
        from ..queue.jobs import enqueue_research

        try:
            job_id = await enqueue_research(
                phone_number=context.phone_number,
                email=context.state.email,
                linkedin_url=context.state.linkedin_url,
                first_name=context.state.first_name,
                last_name=context.state.last_name,
                company_name=context.state.company_name,
            )
            logger.info(f"Enqueued research job {job_id} for {context.phone_number}")
        except Exception as e:
            logger.error(f"Failed to enqueue research: {e}")
