"""
Shared pytest fixtures for swarm agent testing.

Provides fixtures for:
- FakeRedis, FakePool, FakeEventBus, FakeBlackboard
- ContactState and SwarmEvent factories
- AgentTestHarness for each agent type
"""

import sys
import types
import pytest
from pathlib import Path
from typing import Dict, Any, Optional, List

# Stub asyncpg before importing anything from src
if "asyncpg" not in sys.modules:
    asyncpg_stub = types.ModuleType("asyncpg")

    async def _create_pool_stub(*_args, **_kwargs):
        raise RuntimeError("asyncpg is stubbed in unit tests")

    asyncpg_stub.create_pool = _create_pool_stub
    asyncpg_stub.Pool = object
    sys.modules["asyncpg"] = asyncpg_stub

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Clear cached src modules to ensure fresh imports with stubs
for module_name in list(sys.modules.keys()):
    if module_name == "src" or module_name.startswith("src."):
        del sys.modules[module_name]

# Now import from src
from src.swarm.events import SwarmEvent, EventType
from src.swarm.blackboard import ContactState

# Import test helpers
from tests.helpers.fakes import (
    FakeRedis,
    FakePool,
    FakeEventBus,
    FakeBlackboard,
)
from tests.helpers.agent_harness import (
    AgentTestHarness,
    contact_factory,
    event_factory,
)


# ============================================================================
# Fake Backend Fixtures
# ============================================================================


@pytest.fixture
def fake_redis():
    """Provide a FakeRedis instance."""
    return FakeRedis()


@pytest.fixture
def fake_pool():
    """Provide a FakePool instance."""
    return FakePool()


@pytest.fixture
def fake_eventbus():
    """Provide a FakeEventBus instance."""
    return FakeEventBus()


@pytest.fixture
def fake_blackboard(fake_redis, fake_pool):
    """Provide a FakeBlackboard instance."""
    return FakeBlackboard(redis=fake_redis, pool=fake_pool)


# ============================================================================
# Factory Fixtures
# ============================================================================


@pytest.fixture
def contact_factory_fixture():
    """Provide the contact_factory function."""
    return contact_factory


@pytest.fixture
def event_factory_fixture():
    """Provide the event_factory function."""
    return event_factory


# ============================================================================
# Agent Harness Fixtures
# ============================================================================


@pytest.fixture
def research_agent_harness():
    """Provide a test harness for ResearchAgent."""
    from src.swarm.agents.research_agent import ResearchAgent

    return AgentTestHarness(ResearchAgent)


@pytest.fixture
def video_agent_harness():
    """Provide a test harness for VideoAgent."""
    from src.swarm.agents.video_agent import VideoAgent

    return AgentTestHarness(VideoAgent)


@pytest.fixture
def voice_agent_harness():
    """Provide a test harness for VoiceAgent."""
    from src.swarm.agents.voice_agent import VoiceAgent

    return AgentTestHarness(VoiceAgent)


@pytest.fixture
def crm_agent_harness():
    """Provide a test harness for CRMAgent."""
    from src.swarm.agents.crm_agent import CRMAgent

    return AgentTestHarness(CRMAgent)


@pytest.fixture
def qualification_agent_harness():
    """Provide a test harness for QualificationAgent."""
    from src.swarm.agents.qualification_agent import QualificationAgent

    return AgentTestHarness(QualificationAgent)


@pytest.fixture
def personalization_agent_harness():
    """Provide a test harness for PersonalizationAgent."""
    from src.swarm.agents.personalization_agent import PersonalizationAgent

    return AgentTestHarness(PersonalizationAgent)


@pytest.fixture
def messaging_agent_harness():
    """Provide a test harness for MessagingAgent."""
    from src.swarm.agents.messaging_agent import MessagingAgent

    return AgentTestHarness(MessagingAgent)


# ============================================================================
# Test Data Fixtures
# ============================================================================


@pytest.fixture
def sample_contact():
    """Provide a sample ContactState for testing."""
    return contact_factory(
        phone_number="1234567890",
        first_name="John",
        last_name="Doe",
        email="john.doe@example.com",
        company_name="Acme Corp",
        job_title="Software Engineer",
        research_status="pending",
    )


@pytest.fixture
def qualified_contact():
    """Provide a qualified ContactState for testing."""
    return contact_factory(
        phone_number="9876543210",
        first_name="Jane",
        last_name="Smith",
        email="jane.smith@techcorp.com",
        company_name="TechCorp",
        job_title="VP Engineering",
        research_status="complete",
        qualification_tier="hot",
        qualification_score=85,
    )


@pytest.fixture
def new_contact():
    """Provide a minimal new ContactState for testing."""
    return contact_factory(
        phone_number="5555555555",
        push_name="New User",
    )


@pytest.fixture
def sample_research_data():
    """Provide sample research data from PDL."""
    return {
        "full_name": "John Doe",
        "first_name": "John",
        "last_name": "Doe",
        "job_title": "Senior Software Engineer",
        "company_name": "Acme Corp",
        "company_industry": "Technology",
        "company_size": "201-500",
        "linkedin_url": "https://linkedin.com/in/johndoe",
        "work_email": "john.doe@acme.com",
        "location": "San Francisco, CA, USA",
        "skills": ["Python", "Machine Learning", "Data Science"],
        "experience_years": 10,
        "education": [
            {
                "school": "Stanford University",
                "degree": "MS",
                "field": "Computer Science",
            }
        ],
        "work_history": [
            {
                "title": "Senior Software Engineer",
                "company": "Acme Corp",
                "start_date": "2020-01",
                "end_date": None,
            }
        ],
    }


# ============================================================================
# Event Fixtures
# ============================================================================


@pytest.fixture
def contact_created_event(sample_contact):
    """Provide a CONTACT_CREATED event."""
    return event_factory(
        event_type=EventType.CONTACT_CREATED,
        contact_id=sample_contact.phone_number,
        payload={"push_name": "John Doe"},
    )


@pytest.fixture
def message_received_event(sample_contact):
    """Provide a MESSAGE_RECEIVED event."""
    return event_factory(
        event_type=EventType.MESSAGE_RECEIVED,
        contact_id=sample_contact.phone_number,
        payload={
            "text": "Hello, I'm interested in your services.",
            "message_type": "text",
        },
    )


@pytest.fixture
def research_completed_event(sample_contact, sample_research_data):
    """Provide a RESEARCH_COMPLETED event."""
    return event_factory(
        event_type=EventType.RESEARCH_COMPLETED,
        contact_id=sample_contact.phone_number,
        payload={
            "research_data": sample_research_data,
            "source": "pdl",
        },
    )


@pytest.fixture
def video_requested_event(qualified_contact):
    """Provide a VIDEO_REQUESTED event."""
    return event_factory(
        event_type=EventType.VIDEO_REQUESTED,
        contact_id=qualified_contact.phone_number,
        payload={
            "script": "Hello Jane! I noticed you're the VP of Engineering at TechCorp. I'd love to connect.",
        },
    )


@pytest.fixture
def voice_requested_event(sample_contact):
    """Provide a VOICE_REQUESTED event."""
    return event_factory(
        event_type=EventType.VOICE_REQUESTED,
        contact_id=sample_contact.phone_number,
        payload={
            "script": "Hi John, thanks for reaching out!",
        },
    )


@pytest.fixture
def qualification_completed_event(sample_contact):
    """Provide a QUALIFICATION_COMPLETED event."""
    return event_factory(
        event_type=EventType.QUALIFICATION_COMPLETED,
        contact_id=sample_contact.phone_number,
        payload={
            "tier": "hot",
            "score": 85,
        },
    )
