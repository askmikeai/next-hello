"""
Networking Crew - Main CrewAI crew for NextHello

Orchestrates multiple agents to handle networking follow-up tasks:
- Research contacts using PDL
- Qualify leads
- Generate personalized content
- Create videos and voice messages
- Sync to CRM
"""

from pathlib import Path
from typing import Any, Optional

import yaml
from crewai import Crew, Process, Task

from ..agents import NetworkingAgents


class NetworkingCrew:
    """
    Main crew for handling networking contacts.

    Supports different workflows:
    - research_and_qualify: Research a contact and score them
    - generate_content: Create personalized messages/videos
    - full_pipeline: Complete workflow from research to CRM sync
    """

    def __init__(
        self,
        llm_provider: Optional[str] = None,
        owner_name: str = "the host",
        event_name: str = "the event",
    ):
        """
        Initialize the networking crew.

        Args:
            llm_provider: LLM provider string (e.g., "anthropic/claude-3-5-sonnet-20241022")
            owner_name: Name of the networking event host
            event_name: Name of the event
        """
        self.agents = NetworkingAgents(
            llm_provider=llm_provider,
            owner_name=owner_name,
            event_name=event_name,
        )
        self.owner_name = owner_name
        self.event_name = event_name

        # Load task configs
        config_path = Path(__file__).parent.parent.parent / "config" / "tasks.yaml"
        with open(config_path) as f:
            self.task_configs = yaml.safe_load(f)

    def _format_task_config(self, task_name: str, variables: dict) -> dict:
        """Format task config with variables"""
        config = self.task_configs[task_name].copy()
        for key in ["description", "expected_output"]:
            if key in config:
                config[key] = config[key].format(**variables)
        return config

    def research_contact(
        self,
        phone_number: str,
        email: Optional[str] = None,
        linkedin_url: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        company_name: Optional[str] = None,
    ) -> Any:
        """
        Research a contact using PDL.

        Returns enriched profile data.
        """
        variables = {
            "phone_number": phone_number,
            "email": email or "Not provided",
            "linkedin_url": linkedin_url or "Not provided",
            "first_name": first_name or "",
            "last_name": last_name or "",
            "company_name": company_name or "Not provided",
        }

        config = self._format_task_config("research_contact", variables)
        research_agent = self.agents.research_agent()

        task = Task(
            description=config["description"],
            expected_output=config["expected_output"],
            agent=research_agent,
        )

        crew = Crew(
            agents=[research_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def qualify_lead(
        self,
        phone_number: str,
        contact_data: dict,
        research_data: Optional[dict] = None,
        conversation_turns: int = 0,
        has_meeting: bool = False,
        last_activity: Optional[str] = None,
    ) -> Any:
        """
        Qualify a lead based on their profile and engagement.

        Returns qualification score and tier.
        """
        variables = {
            "contact_data": str(contact_data),
            "research_data": str(research_data or {}),
            "conversation_turns": conversation_turns,
            "has_meeting": has_meeting,
            "last_activity": last_activity or "Unknown",
        }

        config = self._format_task_config("qualify_lead", variables)
        qualification_agent = self.agents.qualification_agent()

        task = Task(
            description=config["description"],
            expected_output=config["expected_output"],
            agent=qualification_agent,
        )

        crew = Crew(
            agents=[qualification_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def generate_welcome_message(
        self,
        first_name: str,
        company_name: Optional[str] = None,
        job_title: Optional[str] = None,
        include_calendly: bool = False,
    ) -> Any:
        """
        Generate a personalized welcome message.

        Returns the welcome message text.
        """
        variables = {
            "first_name": first_name,
            "event_name": self.event_name,
            "company_name": company_name or "Unknown",
            "job_title": job_title or "Unknown",
            "owner_name": self.owner_name,
            "include_calendly": "Include Calendly link at the end" if include_calendly else "Do not include scheduling link",
        }

        config = self._format_task_config("generate_welcome_message", variables)
        personalization_agent = self.agents.personalization_agent()

        task = Task(
            description=config["description"],
            expected_output=config["expected_output"],
            agent=personalization_agent,
        )

        crew = Crew(
            agents=[personalization_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def generate_video_script(
        self,
        first_name: str,
        company_name: Optional[str] = None,
        job_title: Optional[str] = None,
        research_summary: Optional[str] = None,
        max_seconds: int = 45,
        call_to_action: str = "book a call",
    ) -> Any:
        """
        Generate a personalized video script.

        Returns the script text and estimated duration.
        """
        max_words = int((max_seconds / 60) * 150)

        variables = {
            "first_name": first_name,
            "event_name": self.event_name,
            "company_name": company_name or "Unknown",
            "job_title": job_title or "Unknown",
            "research_summary": research_summary or "No research available",
            "max_seconds": max_seconds,
            "max_words": max_words,
            "call_to_action": call_to_action,
        }

        config = self._format_task_config("generate_video_script", variables)
        personalization_agent = self.agents.personalization_agent()

        task = Task(
            description=config["description"],
            expected_output=config["expected_output"],
            agent=personalization_agent,
        )

        crew = Crew(
            agents=[personalization_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def generate_video(
        self,
        phone_number: str,
        script: str,
    ) -> Any:
        """
        Generate a HeyGen video.

        Returns video ID and status.
        """
        variables = {
            "phone_number": phone_number,
            "video_script": script,
        }

        config = self._format_task_config("generate_heygen_video", variables)
        video_agent = self.agents.video_agent()

        task = Task(
            description=config["description"],
            expected_output=config["expected_output"],
            agent=video_agent,
        )

        crew = Crew(
            agents=[video_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def generate_voice_message(
        self,
        phone_number: str,
        script: str,
    ) -> Any:
        """
        Generate an ElevenLabs voice message.

        Returns audio file path.
        """
        variables = {
            "phone_number": phone_number,
            "voice_script": script,
        }

        config = self._format_task_config("generate_voice_message", variables)
        voice_agent = self.agents.voice_agent()

        task = Task(
            description=config["description"],
            expected_output=config["expected_output"],
            agent=voice_agent,
        )

        crew = Crew(
            agents=[voice_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def sync_to_crm(
        self,
        phone_number: str,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        email: Optional[str] = None,
        company_name: Optional[str] = None,
        job_title: Optional[str] = None,
        create_deal: bool = False,
        deal_name: Optional[str] = None,
        note: Optional[str] = None,
    ) -> Any:
        """
        Sync a contact to HubSpot CRM.

        Returns CRM contact ID and sync status.
        """
        variables = {
            "phone_number": phone_number,
            "first_name": first_name or "",
            "last_name": last_name or "",
            "email": email or "",
            "company_name": company_name or "",
            "job_title": job_title or "",
            "create_deal": create_deal,
            "deal_name": deal_name or f"{first_name or 'New'} {last_name or 'Contact'} - {self.event_name}",
            "note": note or "",
        }

        config = self._format_task_config("sync_to_crm", variables)
        crm_agent = self.agents.crm_agent()

        task = Task(
            description=config["description"],
            expected_output=config["expected_output"],
            agent=crm_agent,
        )

        crew = Crew(
            agents=[crm_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def research_and_qualify(
        self,
        phone_number: str,
        email: Optional[str] = None,
        linkedin_url: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        company_name: Optional[str] = None,
    ) -> Any:
        """
        Research a contact and qualify them in one workflow.

        Returns both research data and qualification.
        """
        research_agent = self.agents.research_agent()
        qualification_agent = self.agents.qualification_agent()

        # Research task
        research_variables = {
            "phone_number": phone_number,
            "email": email or "Not provided",
            "linkedin_url": linkedin_url or "Not provided",
            "first_name": first_name or "",
            "last_name": last_name or "",
            "company_name": company_name or "Not provided",
        }
        research_config = self._format_task_config("research_contact", research_variables)

        research_task = Task(
            description=research_config["description"],
            expected_output=research_config["expected_output"],
            agent=research_agent,
        )

        # Qualification task (depends on research)
        qualify_variables = {
            "contact_data": f"Phone: {phone_number}, Name: {first_name} {last_name}, Email: {email}",
            "research_data": "Use the research results from the previous task",
            "conversation_turns": 0,
            "has_meeting": False,
            "last_activity": "Now",
        }
        qualify_config = self._format_task_config("qualify_lead", qualify_variables)

        qualification_task = Task(
            description=qualify_config["description"],
            expected_output=qualify_config["expected_output"],
            agent=qualification_agent,
            context=[research_task],  # Depends on research
        )

        crew = Crew(
            agents=[research_agent, qualification_agent],
            tasks=[research_task, qualification_task],
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()

    def full_pipeline(
        self,
        phone_number: str,
        email: Optional[str] = None,
        linkedin_url: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        company_name: Optional[str] = None,
        generate_video: bool = False,
        sync_to_crm: bool = True,
    ) -> Any:
        """
        Run the full pipeline: research → qualify → personalize → CRM sync.

        This is the complete workflow for processing a new networking contact.
        """
        agents_dict = self.agents.all_agents()

        tasks = []

        # 1. Research
        research_variables = {
            "phone_number": phone_number,
            "email": email or "Not provided",
            "linkedin_url": linkedin_url or "Not provided",
            "first_name": first_name or "",
            "last_name": last_name or "",
            "company_name": company_name or "Not provided",
        }
        research_config = self._format_task_config("research_contact", research_variables)
        research_task = Task(
            description=research_config["description"],
            expected_output=research_config["expected_output"],
            agent=agents_dict["research"],
        )
        tasks.append(research_task)

        # 2. Qualify
        qualify_variables = {
            "contact_data": f"Phone: {phone_number}",
            "research_data": "Use research results from previous task",
            "conversation_turns": 0,
            "has_meeting": False,
            "last_activity": "Now",
        }
        qualify_config = self._format_task_config("qualify_lead", qualify_variables)
        qualification_task = Task(
            description=qualify_config["description"],
            expected_output=qualify_config["expected_output"],
            agent=agents_dict["qualification"],
            context=[research_task],
        )
        tasks.append(qualification_task)

        # 3. Generate welcome message
        welcome_variables = {
            "first_name": first_name or "there",
            "event_name": self.event_name,
            "company_name": company_name or "Unknown",
            "job_title": "Unknown",
            "owner_name": self.owner_name,
            "include_calendly": "Include Calendly link",
        }
        welcome_config = self._format_task_config("generate_welcome_message", welcome_variables)
        welcome_task = Task(
            description=welcome_config["description"],
            expected_output=welcome_config["expected_output"],
            agent=agents_dict["personalization"],
            context=[research_task, qualification_task],
        )
        tasks.append(welcome_task)

        # 4. Video script (optional)
        if generate_video:
            video_script_variables = {
                "first_name": first_name or "there",
                "event_name": self.event_name,
                "company_name": company_name or "Unknown",
                "job_title": "Unknown",
                "research_summary": "Use research from earlier tasks",
                "max_seconds": 45,
                "max_words": 112,
                "call_to_action": "book a call",
            }
            video_config = self._format_task_config("generate_video_script", video_script_variables)
            video_script_task = Task(
                description=video_config["description"],
                expected_output=video_config["expected_output"],
                agent=agents_dict["personalization"],
                context=[research_task],
            )
            tasks.append(video_script_task)

        # 5. CRM sync (optional)
        if sync_to_crm:
            crm_variables = {
                "phone_number": phone_number,
                "first_name": first_name or "",
                "last_name": last_name or "",
                "email": email or "",
                "company_name": company_name or "",
                "job_title": "",
                "create_deal": True,
                "deal_name": f"{first_name or 'New'} {last_name or 'Contact'} - {self.event_name}",
                "note": "Contact from networking event. Qualification and research data available.",
            }
            crm_config = self._format_task_config("sync_to_crm", crm_variables)
            crm_task = Task(
                description=crm_config["description"],
                expected_output=crm_config["expected_output"],
                agent=agents_dict["crm"],
                context=[research_task, qualification_task],
            )
            tasks.append(crm_task)

        # Build agent list (unique agents used)
        agent_list = [agents_dict["research"], agents_dict["qualification"], agents_dict["personalization"]]
        if sync_to_crm:
            agent_list.append(agents_dict["crm"])

        crew = Crew(
            agents=agent_list,
            tasks=tasks,
            process=Process.sequential,
            verbose=True,
        )

        return crew.kickoff()
