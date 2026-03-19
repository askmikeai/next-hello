"""
Job Queue Worker

Processes background jobs using ARQ.

Run with:
    arq src.queue.worker.WorkerSettings
"""

import os
import logging
from typing import Any

from arq import cron
from arq.connections import RedisSettings

from ..crews import NetworkingCrew
from ..channels.whatsapp import WhatsAppClient
from ..state import RedisStateManager
from .jobs import get_redis_settings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Global instances (initialized per worker)
_crew: NetworkingCrew | None = None
_whatsapp: WhatsAppClient | None = None
_state_manager: RedisStateManager | None = None


async def startup(ctx: dict) -> None:
    """Initialize resources on worker startup"""
    global _crew, _whatsapp, _state_manager

    logger.info("Worker starting up...")

    _crew = NetworkingCrew(
        llm_provider=os.getenv("LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514"),
        owner_name=os.getenv("OWNER_NAME", "the host"),
        event_name=os.getenv("EVENT_NAME", "the event"),
    )

    try:
        _whatsapp = WhatsAppClient()
    except ValueError:
        logger.warning("WhatsApp client not configured - message sending disabled")
        _whatsapp = None

    _state_manager = RedisStateManager()
    await _state_manager.connect()

    ctx["crew"] = _crew
    ctx["whatsapp"] = _whatsapp
    ctx["state_manager"] = _state_manager

    logger.info("Worker startup complete")


async def shutdown(ctx: dict) -> None:
    """Cleanup resources on worker shutdown"""
    global _state_manager, _whatsapp

    logger.info("Worker shutting down...")

    if _state_manager:
        await _state_manager.close()

    if _whatsapp:
        await _whatsapp.close()

    logger.info("Worker shutdown complete")


# =============================================================================
# Job Handlers
# =============================================================================


async def research_contact(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Research a contact using People Data Labs"""
    logger.info(f"Researching contact: {phone_number}")

    crew: NetworkingCrew = ctx["crew"]
    state_manager: RedisStateManager = ctx["state_manager"]

    try:
        result = crew.research_contact(
            phone_number=phone_number,
            email=data.get("email"),
            linkedin_url=data.get("linkedin_url"),
            first_name=data.get("first_name"),
            last_name=data.get("last_name"),
            company_name=data.get("company_name"),
        )

        # Store result in state
        await state_manager.set_agent_result(
            phone_number,
            "research",
            str(result),
            ttl=86400,  # 24 hours
        )

        # Update contact state with research data
        await state_manager.update_state(
            phone_number,
            research_data={"raw": str(result)},
        )

        logger.info(f"Research complete for {phone_number}")
        return {"success": True, "result": str(result)}

    except Exception as e:
        logger.error(f"Research failed for {phone_number}: {e}")
        return {"success": False, "error": str(e)}


async def qualify_lead(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Qualify a lead based on their profile"""
    logger.info(f"Qualifying lead: {phone_number}")

    crew: NetworkingCrew = ctx["crew"]
    state_manager: RedisStateManager = ctx["state_manager"]

    try:
        result = crew.qualify_lead(
            phone_number=phone_number,
            contact_data=data.get("contact_data", {}),
            research_data=data.get("research_data"),
        )

        # Store result in state
        await state_manager.set_agent_result(
            phone_number,
            "qualification",
            str(result),
            ttl=86400,
        )

        # Update contact state
        await state_manager.update_state(
            phone_number,
            qualification_data={"raw": str(result)},
        )

        logger.info(f"Qualification complete for {phone_number}")
        return {"success": True, "result": str(result)}

    except Exception as e:
        logger.error(f"Qualification failed for {phone_number}: {e}")
        return {"success": False, "error": str(e)}


async def generate_video(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Generate a HeyGen video"""
    logger.info(f"Generating video for: {phone_number}")

    crew: NetworkingCrew = ctx["crew"]
    state_manager: RedisStateManager = ctx["state_manager"]

    try:
        result = crew.generate_video(
            phone_number=phone_number,
            script=data.get("script", ""),
        )

        # Store result
        await state_manager.set_agent_result(
            phone_number,
            "video",
            str(result),
            ttl=3600,
        )

        # Mark video sent
        await state_manager.update_state(phone_number, video_sent=True)

        logger.info(f"Video generation complete for {phone_number}")
        return {"success": True, "result": str(result)}

    except Exception as e:
        logger.error(f"Video generation failed for {phone_number}: {e}")
        return {"success": False, "error": str(e)}


async def generate_voice(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Generate an ElevenLabs voice message"""
    logger.info(f"Generating voice for: {phone_number}")

    crew: NetworkingCrew = ctx["crew"]
    state_manager: RedisStateManager = ctx["state_manager"]

    try:
        result = crew.generate_voice_message(
            phone_number=phone_number,
            script=data.get("script", ""),
        )

        # Store result
        await state_manager.set_agent_result(
            phone_number,
            "voice",
            str(result),
            ttl=3600,
        )

        # Mark voice sent
        await state_manager.update_state(phone_number, voice_sent=True)

        logger.info(f"Voice generation complete for {phone_number}")
        return {"success": True, "result": str(result)}

    except Exception as e:
        logger.error(f"Voice generation failed for {phone_number}: {e}")
        return {"success": False, "error": str(e)}


async def sync_crm(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Sync contact to HubSpot CRM"""
    logger.info(f"Syncing to CRM: {phone_number}")

    crew: NetworkingCrew = ctx["crew"]
    state_manager: RedisStateManager = ctx["state_manager"]

    try:
        contact_data = data.get("contact_data", {})
        result = crew.sync_to_crm(
            phone_number=phone_number,
            first_name=contact_data.get("first_name"),
            last_name=contact_data.get("last_name"),
            email=contact_data.get("email"),
            company_name=contact_data.get("company_name"),
            job_title=contact_data.get("job_title"),
            create_deal=data.get("create_deal", False),
            note=data.get("note"),
        )

        # Mark CRM synced
        await state_manager.update_state(phone_number, crm_synced=True)

        logger.info(f"CRM sync complete for {phone_number}")
        return {"success": True, "result": str(result)}

    except Exception as e:
        logger.error(f"CRM sync failed for {phone_number}: {e}")
        return {"success": False, "error": str(e)}


async def full_pipeline(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Run the full pipeline"""
    logger.info(f"Running full pipeline for: {phone_number}")

    crew: NetworkingCrew = ctx["crew"]

    try:
        result = crew.full_pipeline(
            phone_number=phone_number,
            email=data.get("email"),
            linkedin_url=data.get("linkedin_url"),
            first_name=data.get("first_name"),
            last_name=data.get("last_name"),
            company_name=data.get("company_name"),
            generate_video=data.get("generate_video", False),
            sync_to_crm=data.get("sync_to_crm", True),
        )

        logger.info(f"Full pipeline complete for {phone_number}")
        return {"success": True, "result": str(result)}

    except Exception as e:
        logger.error(f"Full pipeline failed for {phone_number}: {e}")
        return {"success": False, "error": str(e)}


async def send_message(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Send an outbound WhatsApp message"""
    logger.info(f"Sending message to: {phone_number}")

    whatsapp: WhatsAppClient | None = ctx.get("whatsapp")
    state_manager: RedisStateManager = ctx["state_manager"]

    if not whatsapp:
        logger.error("WhatsApp client not configured")
        return {"success": False, "error": "WhatsApp not configured"}

    try:
        message_type = data.get("message_type", "text")
        content = data.get("content", "")
        media_url = data.get("media_url")

        if message_type == "text":
            result = await whatsapp.send_text(phone_number, content)
        elif message_type == "image":
            result = await whatsapp.send_image(phone_number, image_url=media_url, caption=content)
        elif message_type == "audio":
            result = await whatsapp.send_audio(phone_number, audio_url=media_url)
        elif message_type == "video":
            result = await whatsapp.send_video(phone_number, video_url=media_url, caption=content)
        else:
            result = await whatsapp.send_text(phone_number, content)

        # Track message in history
        message_id = result.get("messages", [{}])[0].get("id", "unknown")
        await state_manager.add_message(
            phone_number,
            message_id,
            "outgoing",
            message_type,
            content,
            media_url,
        )

        logger.info(f"Message sent to {phone_number}")
        return {"success": True, "result": result}

    except Exception as e:
        logger.error(f"Failed to send message to {phone_number}: {e}")
        return {"success": False, "error": str(e)}


async def transcribe_audio(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """Transcribe audio message using OpenAI Whisper"""
    logger.info(f"Transcribing audio for: {phone_number}")

    # This would use OpenAI's Whisper API
    # For now, return a placeholder
    return {"success": True, "transcription": "[Audio transcription not implemented]"}


async def process_incoming_message(
    ctx: dict,
    phone_number: str,
    data: dict,
) -> dict[str, Any]:
    """
    Process an incoming message.

    Uses SwarmCoordinator (event-driven, agents respond via EventBus)
    or falls back to legacy ConversationOrchestrator if feature flag is off.
    """
    logger.info(f"Processing incoming message from: {phone_number}")

    # Feature flag: use swarm-only mode (coordinator + events)
    use_swarm_only = os.getenv("ENABLE_SWARM_ONLY_MODE", "true").lower() in ("1", "true", "yes", "on")

    state_manager: RedisStateManager = ctx["state_manager"]
    whatsapp: WhatsAppClient | None = ctx.get("whatsapp")
    owner_id = data.get("owner_id") or os.getenv(
        "NEXTHELLO_SYSTEM_OWNER_ID",
        os.getenv("NEXTHELLO_DEFAULT_OWNER_ID", "askmikeai@gmail.com"),
    )

    try:
        if use_swarm_only:
            # Use SwarmCoordinator - response comes via PersonalizationAgent -> MessagingAgent
            from ..swarm.coordinator import SwarmCoordinator
            from ..swarm.eventbus import EventBus
            from ..swarm.blackboard import Blackboard

            redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
            database_url = os.getenv("DATABASE_URL")

            eventbus = EventBus(redis_url=redis_url)
            blackboard = Blackboard(redis_url=redis_url, database_url=database_url)

            await eventbus.connect()
            await blackboard.connect()

            coordinator = SwarmCoordinator(eventbus=eventbus, blackboard=blackboard)

            # Process the message - response handled asynchronously by agents
            immediate_response = await coordinator.handle_incoming_message(
                phone_number=phone_number,
                message_text=data.get("content", ""),
                message_type=data.get("message_type", "text"),
                push_name=data.get("push_name"),
                message_id=data.get("message_id"),
                owner_id=owner_id,
            )

            # Send immediate response if any (typically only for new contacts)
            if whatsapp and immediate_response:
                result = await whatsapp.send_text(phone_number, immediate_response)
                message_id = result.get("messages", [{}])[0].get("id", "unknown")

                await state_manager.add_message(
                    phone_number,
                    message_id,
                    "outgoing",
                    "text",
                    immediate_response,
                )

            await eventbus.close()
            await blackboard.close()

            logger.info(f"Processed message from {phone_number} via SwarmCoordinator")
            return {"success": True, "response": immediate_response, "mode": "swarm"}

        else:
            # Legacy mode: use ConversationOrchestrator
            from ..orchestrator import ConversationOrchestrator

            crew: NetworkingCrew = ctx["crew"]

            orchestrator = ConversationOrchestrator(
                state_manager=state_manager,
                crew=crew,
            )

            response = await orchestrator.process_message(
                phone_number=phone_number,
                message_text=data.get("content", ""),
                message_type=data.get("message_type", "text"),
                push_name=data.get("push_name"),
                message_id=data.get("message_id"),
            )

            if whatsapp and response:
                result = await whatsapp.send_text(phone_number, response)
                message_id = result.get("messages", [{}])[0].get("id", "unknown")

                await state_manager.add_message(
                    phone_number,
                    message_id,
                    "outgoing",
                    "text",
                    response,
                )

            logger.info(f"Processed message from {phone_number} via ConversationOrchestrator")
            return {"success": True, "response": response, "mode": "orchestrator"}

    except Exception as e:
        logger.error(f"Failed to process message from {phone_number}: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# Worker Configuration
# =============================================================================


class WorkerSettings:
    """ARQ worker settings"""

    # Redis connection
    redis_settings = get_redis_settings()

    # Job handlers
    functions = [
        research_contact,
        qualify_lead,
        generate_video,
        generate_voice,
        sync_crm,
        full_pipeline,
        send_message,
        transcribe_audio,
        process_incoming_message,
    ]

    # Lifecycle hooks
    on_startup = startup
    on_shutdown = shutdown

    # Worker settings
    max_jobs = 10
    job_timeout = 300  # 5 minutes
    keep_result = 3600  # 1 hour
    poll_delay = 0.5

    # Retry settings
    max_tries = 3
    retry_delay = 10

    # Optional: scheduled jobs
    # cron_jobs = [
    #     cron(cleanup_expired_states, hour=3, minute=0),  # Run at 3 AM
    # ]
