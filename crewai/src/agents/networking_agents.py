"""
Networking Agents - CrewAI agent definitions for NextHello

Uses YAML configuration for agent definitions and supports
multiple LLM providers via CrewAI's LLM class.
"""

import os
from pathlib import Path
from typing import Optional

import yaml
from crewai import Agent, LLM

from ..tools import (
    # Web Search (Serper primary, Perplexity fallback)
    web_search,
    deep_research,
    # PDL
    pdl_enrich_contact,
    pdl_search_company,
    # HeyGen
    heygen_generate_video,
    heygen_check_status,
    # ElevenLabs
    elevenlabs_generate_voice,
    elevenlabs_list_voices,
    # HubSpot
    hubspot_sync_contact,
    hubspot_create_deal,
    hubspot_add_note,
    # OpenClaw
    openclaw_research_contact,
    # Supabase
    get_contact_by_phone,
    update_contact,
    save_research_data,
    save_qualification,
)


class NetworkingAgents:
    """
    Factory for creating networking agents.

    Supports multiple LLM providers:
    - anthropic/claude-3-5-sonnet-20241022 (default)
    - openai/gpt-4o
    - openai/gpt-4o-mini
    - gemini/gemini-2.0-flash
    - ollama/llama3.2

    Set via LLM_PROVIDER env var or pass to constructor.
    """

    def __init__(
        self,
        llm_provider: Optional[str] = None,
        owner_name: str = "the host",
        event_name: str = "the event",
    ):
        """
        Initialize the agent factory.

        Args:
            llm_provider: LLM provider string (e.g., "anthropic/claude-3-5-sonnet-20241022")
            owner_name: Name of the networking event host
            event_name: Name of the event
        """
        self.llm_provider = llm_provider or os.getenv(
            "LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514"
        )
        self.owner_name = owner_name
        self.event_name = event_name

        # Load agent configs from YAML
        config_path = Path(__file__).parent.parent.parent / "config" / "agents.yaml"
        with open(config_path) as f:
            self.agent_configs = yaml.safe_load(f)

        # Create the LLM instance
        self.llm = self._create_llm()

    def _create_llm(self) -> LLM:
        """Create LLM instance based on provider"""
        # Anthropic requires max_tokens
        if self.llm_provider.startswith("anthropic/"):
            return LLM(
                model=self.llm_provider,
                max_tokens=4096,
                temperature=0.7,
            )
        else:
            return LLM(
                model=self.llm_provider,
                temperature=0.7,
            )

    def _format_config(self, config: dict) -> dict:
        """Format agent config with variables"""
        formatted = {}
        for key, value in config.items():
            if isinstance(value, str):
                formatted[key] = value.format(
                    owner_name=self.owner_name,
                    event_name=self.event_name,
                )
            else:
                formatted[key] = value
        return formatted

    def research_agent(self) -> Agent:
        """Create the Research Agent for contact enrichment"""
        config = self._format_config(self.agent_configs["research"])
        return Agent(
            role=config["role"],
            goal=config["goal"],
            backstory=config["backstory"],
            llm=self.llm,
            tools=[
                # Primary: PDL for contact enrichment
                pdl_enrich_contact,
                pdl_search_company,
                # Web search: Serper (cheap) with Perplexity fallback
                web_search,
                deep_research,
                # OpenClaw relay research
                openclaw_research_contact,
                # Database
                get_contact_by_phone,
                save_research_data,
            ],
            allow_delegation=config.get("allow_delegation", False),
            verbose=config.get("verbose", True),
        )

    def qualification_agent(self) -> Agent:
        """Create the Qualification Agent for lead scoring"""
        config = self._format_config(self.agent_configs["qualification"])
        return Agent(
            role=config["role"],
            goal=config["goal"],
            backstory=config["backstory"],
            llm=self.llm,
            tools=[
                # Web search for company research
                web_search,
                # Database
                get_contact_by_phone,
                save_qualification,
            ],
            allow_delegation=config.get("allow_delegation", False),
            verbose=config.get("verbose", True),
        )

    def personalization_agent(self) -> Agent:
        """Create the Personalization Agent for content generation"""
        config = self._format_config(self.agent_configs["personalization"])
        return Agent(
            role=config["role"],
            goal=config["goal"],
            backstory=config["backstory"],
            llm=LLM(
                model=self.llm_provider,
                max_tokens=4096 if self.llm_provider.startswith("anthropic/") else None,
                temperature=0.8,  # Higher temperature for creative content
            ),
            tools=[get_contact_by_phone],
            allow_delegation=config.get("allow_delegation", False),
            verbose=config.get("verbose", True),
        )

    def video_agent(self) -> Agent:
        """Create the Video Agent for HeyGen video generation"""
        config = self._format_config(self.agent_configs["video"])
        return Agent(
            role=config["role"],
            goal=config["goal"],
            backstory=config["backstory"],
            llm=self.llm,
            tools=[
                heygen_generate_video,
                heygen_check_status,
                get_contact_by_phone,
                update_contact,
            ],
            allow_delegation=config.get("allow_delegation", False),
            verbose=config.get("verbose", True),
        )

    def voice_agent(self) -> Agent:
        """Create the Voice Agent for ElevenLabs voice generation"""
        config = self._format_config(self.agent_configs["voice"])
        return Agent(
            role=config["role"],
            goal=config["goal"],
            backstory=config["backstory"],
            llm=self.llm,
            tools=[
                elevenlabs_generate_voice,
                elevenlabs_list_voices,
                get_contact_by_phone,
                update_contact,
            ],
            allow_delegation=config.get("allow_delegation", False),
            verbose=config.get("verbose", True),
        )

    def crm_agent(self) -> Agent:
        """Create the CRM Agent for HubSpot synchronization"""
        config = self._format_config(self.agent_configs["crm"])
        return Agent(
            role=config["role"],
            goal=config["goal"],
            backstory=config["backstory"],
            llm=self.llm,
            tools=[
                hubspot_sync_contact,
                hubspot_create_deal,
                hubspot_add_note,
                get_contact_by_phone,
                update_contact,
            ],
            allow_delegation=config.get("allow_delegation", False),
            verbose=config.get("verbose", True),
        )

    def orchestrator_agent(self) -> Agent:
        """Create the Orchestrator Agent for conversation coordination"""
        config = self._format_config(self.agent_configs["orchestrator"])
        return Agent(
            role=config["role"],
            goal=config["goal"],
            backstory=config["backstory"],
            llm=self.llm,
            tools=[get_contact_by_phone, update_contact],
            allow_delegation=config.get("allow_delegation", True),
            verbose=config.get("verbose", True),
        )

    def all_agents(self) -> dict[str, Agent]:
        """Get all agents as a dictionary"""
        return {
            "orchestrator": self.orchestrator_agent(),
            "research": self.research_agent(),
            "qualification": self.qualification_agent(),
            "personalization": self.personalization_agent(),
            "video": self.video_agent(),
            "voice": self.voice_agent(),
            "crm": self.crm_agent(),
        }
