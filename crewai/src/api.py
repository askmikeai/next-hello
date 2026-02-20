"""
NextHello CrewAI API

Complete FastAPI application with:
- WhatsApp Cloud API webhooks
- CrewAI agent endpoints
- State management
- Background job queue
"""

import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .crews import NetworkingCrew
from .channels.whatsapp import WhatsAppClient, WhatsAppWebhook, IncomingMessage
from .state import RedisStateManager, ConversationState
from .queue.jobs import (
    enqueue_process_incoming,
    enqueue_research,
    enqueue_qualification,
    enqueue_video,
    enqueue_voice,
    enqueue_crm_sync,
    enqueue_send_message,
)
from .swarm import SwarmCoordinator, EventBus, Blackboard

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global instances
_crew: Optional[NetworkingCrew] = None
_whatsapp_client: Optional[WhatsAppClient] = None
_whatsapp_webhook: Optional[WhatsAppWebhook] = None
_state_manager: Optional[RedisStateManager] = None
_swarm_coordinator: Optional[SwarmCoordinator] = None
_eventbus: Optional[EventBus] = None
_blackboard: Optional[Blackboard] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global _state_manager, _whatsapp_client, _whatsapp_webhook
    global _swarm_coordinator, _eventbus, _blackboard

    # Startup
    logger.info("Starting NextHello CrewAI API...")

    _state_manager = RedisStateManager()
    await _state_manager.connect()

    _whatsapp_webhook = WhatsAppWebhook()

    try:
        _whatsapp_client = WhatsAppClient()
        logger.info("WhatsApp client initialized")
    except ValueError as e:
        logger.warning(f"WhatsApp client not configured: {e}")

    # Initialize swarm components
    _eventbus = EventBus()
    await _eventbus.connect()

    _blackboard = Blackboard()
    await _blackboard.connect()

    _swarm_coordinator = SwarmCoordinator(
        eventbus=_eventbus,
        blackboard=_blackboard,
    )
    logger.info("Swarm coordinator initialized")

    logger.info("Startup complete")

    yield

    # Shutdown
    logger.info("Shutting down...")
    if _eventbus:
        await _eventbus.close()
    if _blackboard:
        await _blackboard.close()
    if _state_manager:
        await _state_manager.close()
    if _whatsapp_client:
        await _whatsapp_client.close()
    logger.info("Shutdown complete")


app = FastAPI(
    title="NextHello CrewAI API",
    description="Multi-agent networking assistant powered by CrewAI",
    version="1.0.0",
    lifespan=lifespan,
)


def get_crew() -> NetworkingCrew:
    """Get or create the crew instance"""
    global _crew
    if _crew is None:
        _crew = NetworkingCrew(
            llm_provider=os.getenv("LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514"),
            owner_name=os.getenv("OWNER_NAME", "the host"),
            event_name=os.getenv("EVENT_NAME", "the event"),
        )
    return _crew


# ============================================================================
# Request/Response Models
# ============================================================================


class ResearchRequest(BaseModel):
    """Request to research a contact"""

    phone_number: str = Field(..., description="Contact's phone number")
    email: Optional[str] = Field(None, description="Contact's email")
    linkedin_url: Optional[str] = Field(None, description="LinkedIn profile URL")
    first_name: Optional[str] = Field(None, description="First name")
    last_name: Optional[str] = Field(None, description="Last name")
    company_name: Optional[str] = Field(None, description="Company name")
    async_mode: bool = Field(False, description="Run in background")


class QualifyRequest(BaseModel):
    """Request to qualify a lead"""

    phone_number: str = Field(..., description="Contact's phone number")
    contact_data: dict = Field(..., description="Contact profile data")
    research_data: Optional[dict] = Field(None, description="Research data from PDL")
    conversation_turns: int = Field(0, description="Number of conversation turns")
    has_meeting: bool = Field(False, description="Whether a meeting is scheduled")
    last_activity: Optional[str] = Field(None, description="Last activity timestamp")


class WelcomeMessageRequest(BaseModel):
    """Request to generate a welcome message"""

    first_name: str = Field(..., description="Contact's first name")
    company_name: Optional[str] = Field(None, description="Company name")
    job_title: Optional[str] = Field(None, description="Job title")
    include_calendly: bool = Field(False, description="Include Calendly link")


class VideoScriptRequest(BaseModel):
    """Request to generate a video script"""

    first_name: str = Field(..., description="Contact's first name")
    company_name: Optional[str] = Field(None, description="Company name")
    job_title: Optional[str] = Field(None, description="Job title")
    research_summary: Optional[str] = Field(None, description="Research summary")
    max_seconds: int = Field(45, description="Max video duration in seconds")
    call_to_action: str = Field("book a call", description="Call to action")


class GenerateVideoRequest(BaseModel):
    """Request to generate a HeyGen video"""

    phone_number: str = Field(..., description="Contact's phone number")
    script: str = Field(..., description="Video script")
    async_mode: bool = Field(True, description="Run in background")


class GenerateVoiceRequest(BaseModel):
    """Request to generate a voice message"""

    phone_number: str = Field(..., description="Contact's phone number")
    script: str = Field(..., description="Voice message script")
    async_mode: bool = Field(True, description="Run in background")


class CRMSyncRequest(BaseModel):
    """Request to sync contact to CRM"""

    phone_number: str = Field(..., description="Contact's phone number")
    first_name: Optional[str] = Field(None, description="First name")
    last_name: Optional[str] = Field(None, description="Last name")
    email: Optional[str] = Field(None, description="Email address")
    company_name: Optional[str] = Field(None, description="Company name")
    job_title: Optional[str] = Field(None, description="Job title")
    create_deal: bool = Field(False, description="Create a deal")
    deal_name: Optional[str] = Field(None, description="Custom deal name")
    note: Optional[str] = Field(None, description="Note to add")


class FullPipelineRequest(BaseModel):
    """Request to run the full pipeline"""

    phone_number: str = Field(..., description="Contact's phone number")
    email: Optional[str] = Field(None, description="Email address")
    linkedin_url: Optional[str] = Field(None, description="LinkedIn URL")
    first_name: Optional[str] = Field(None, description="First name")
    last_name: Optional[str] = Field(None, description="Last name")
    company_name: Optional[str] = Field(None, description="Company name")
    generate_video: bool = Field(False, description="Generate a video")
    sync_to_crm: bool = Field(True, description="Sync to CRM")


class SendMessageRequest(BaseModel):
    """Request to send a WhatsApp message"""

    phone_number: str = Field(..., description="Recipient phone number")
    message_type: str = Field("text", description="Message type (text, image, audio, video)")
    content: str = Field(..., description="Message content or caption")
    media_url: Optional[str] = Field(None, description="Media URL for non-text messages")


class CrewResponse(BaseModel):
    """Generic response from crew execution"""

    success: bool = Field(..., description="Whether the operation succeeded")
    result: Any = Field(None, description="Result from the crew")
    error: Optional[str] = Field(None, description="Error message if failed")
    job_id: Optional[str] = Field(None, description="Background job ID if async")


# ============================================================================
# Health Check
# ============================================================================


@app.get("/")
async def root():
    """Root endpoint - API info"""
    return {
        "name": "NextHello CrewAI API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "llm_provider": os.getenv("LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514"),
        "whatsapp_configured": _whatsapp_client is not None,
        "redis_connected": _state_manager is not None,
    }


# ============================================================================
# WhatsApp Webhook Endpoints
# ============================================================================


@app.get("/webhook/whatsapp")
async def verify_whatsapp_webhook(
    mode: str = Query(None, alias="hub.mode"),
    token: str = Query(None, alias="hub.verify_token"),
    challenge: str = Query(None, alias="hub.challenge"),
):
    """
    WhatsApp webhook verification endpoint.

    Meta sends a GET request to verify the webhook URL.
    """
    if not _whatsapp_webhook:
        raise HTTPException(status_code=500, detail="Webhook not configured")

    result = _whatsapp_webhook.verify_webhook(mode, token, challenge)
    if result:
        logger.info("WhatsApp webhook verified successfully")
        return Response(content=result, media_type="text/plain")
    else:
        logger.warning("WhatsApp webhook verification failed")
        raise HTTPException(status_code=403, detail="Verification failed")


@app.post("/webhook/whatsapp")
async def handle_whatsapp_webhook(request: Request):
    """
    WhatsApp webhook handler for incoming messages.

    Meta sends a POST request with message data.
    """
    if not _whatsapp_webhook:
        raise HTTPException(status_code=500, detail="Webhook not configured")

    # Get raw body for signature verification
    body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256", "")

    # Verify signature
    if not _whatsapp_webhook.verify_signature(body, signature):
        logger.warning("Invalid webhook signature")
        raise HTTPException(status_code=403, detail="Invalid signature")

    # Parse payload
    try:
        payload = await request.json()
    except Exception as e:
        logger.error(f"Failed to parse webhook payload: {e}")
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Parse messages
    messages = _whatsapp_webhook.parse_webhook(payload)
    logger.info(f"Received {len(messages)} messages from webhook")

    # Process each message
    for message in messages:
        await process_incoming_message(message)

    # Always return 200 to acknowledge receipt
    return {"status": "ok", "messages_received": len(messages)}


async def process_incoming_message(message: IncomingMessage):
    """
    Process an incoming WhatsApp message.

    Enqueues the message for background processing.
    """
    logger.info(
        f"Processing message from {message.from_number}: "
        f"type={message.message_type}, text={message.text[:50] if message.text else 'N/A'}..."
    )

    # Get content based on message type
    content = message.text or message.caption or ""

    # Enqueue for background processing
    job_id = await enqueue_process_incoming(
        phone_number=message.from_number,
        message_id=message.message_id,
        message_type=message.message_type.value,
        content=content,
        push_name=message.push_name,
        media_id=message.media_id,
    )

    logger.info(f"Enqueued message processing job: {job_id}")

    # Mark as read if WhatsApp client is available
    if _whatsapp_client:
        try:
            await _whatsapp_client.mark_as_read(message.message_id)
        except Exception as e:
            logger.warning(f"Failed to mark message as read: {e}")


# ============================================================================
# State Endpoints
# ============================================================================


@app.get("/state/{phone_number}")
async def get_contact_state(phone_number: str):
    """Get conversation state for a contact"""
    if not _state_manager:
        raise HTTPException(status_code=500, detail="State manager not initialized")

    state = await _state_manager.get_state(phone_number)
    if not state:
        raise HTTPException(status_code=404, detail="Contact not found")

    return state.model_dump()


@app.get("/state/{phone_number}/history")
async def get_message_history(
    phone_number: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Get message history for a contact"""
    if not _state_manager:
        raise HTTPException(status_code=500, detail="State manager not initialized")

    history = await _state_manager.get_message_history(phone_number, limit, offset)
    return {"phone_number": phone_number, "messages": history, "count": len(history)}


@app.get("/conversations")
async def list_conversations(limit: int = Query(100, ge=1, le=1000)):
    """List all active conversations"""
    if not _state_manager:
        raise HTTPException(status_code=500, detail="State manager not initialized")

    phone_numbers = await _state_manager.list_active_conversations(limit)
    return {"conversations": phone_numbers, "count": len(phone_numbers)}


# ============================================================================
# Message Sending Endpoints
# ============================================================================


@app.post("/send")
async def send_message(request: SendMessageRequest):
    """Send a WhatsApp message"""
    job_id = await enqueue_send_message(
        phone_number=request.phone_number,
        message_type=request.message_type,
        content=request.content,
        media_url=request.media_url,
    )

    return {
        "status": "queued",
        "job_id": job_id,
        "phone_number": request.phone_number,
    }


@app.post("/send/immediate")
async def send_message_immediate(request: SendMessageRequest):
    """Send a WhatsApp message immediately (not queued)"""
    if not _whatsapp_client:
        raise HTTPException(status_code=500, detail="WhatsApp client not configured")

    try:
        if request.message_type == "text":
            result = await _whatsapp_client.send_text(request.phone_number, request.content)
        elif request.message_type == "image":
            result = await _whatsapp_client.send_image(
                request.phone_number, image_url=request.media_url, caption=request.content
            )
        elif request.message_type == "audio":
            result = await _whatsapp_client.send_audio(request.phone_number, audio_url=request.media_url)
        elif request.message_type == "video":
            result = await _whatsapp_client.send_video(
                request.phone_number, video_url=request.media_url, caption=request.content
            )
        else:
            result = await _whatsapp_client.send_text(request.phone_number, request.content)

        return {"status": "sent", "result": result}

    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Research Endpoints
# ============================================================================


@app.post("/research", response_model=CrewResponse)
async def research_contact(request: ResearchRequest):
    """Research a contact using People Data Labs"""
    if request.async_mode:
        job_id = await enqueue_research(
            phone_number=request.phone_number,
            email=request.email,
            linkedin_url=request.linkedin_url,
            first_name=request.first_name,
            last_name=request.last_name,
            company_name=request.company_name,
        )
        return CrewResponse(success=True, result="Job queued", job_id=job_id)

    try:
        crew = get_crew()
        result = crew.research_contact(
            phone_number=request.phone_number,
            email=request.email,
            linkedin_url=request.linkedin_url,
            first_name=request.first_name,
            last_name=request.last_name,
            company_name=request.company_name,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


# ============================================================================
# Qualification Endpoints
# ============================================================================


@app.post("/qualify", response_model=CrewResponse)
async def qualify_lead(request: QualifyRequest):
    """Qualify a lead based on their profile and engagement"""
    try:
        crew = get_crew()
        result = crew.qualify_lead(
            phone_number=request.phone_number,
            contact_data=request.contact_data,
            research_data=request.research_data,
            conversation_turns=request.conversation_turns,
            has_meeting=request.has_meeting,
            last_activity=request.last_activity,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


# ============================================================================
# Personalization Endpoints
# ============================================================================


@app.post("/personalize/welcome", response_model=CrewResponse)
async def generate_welcome_message(request: WelcomeMessageRequest):
    """Generate a personalized welcome message"""
    try:
        crew = get_crew()
        result = crew.generate_welcome_message(
            first_name=request.first_name,
            company_name=request.company_name,
            job_title=request.job_title,
            include_calendly=request.include_calendly,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


@app.post("/personalize/video-script", response_model=CrewResponse)
async def generate_video_script(request: VideoScriptRequest):
    """Generate a personalized video script"""
    try:
        crew = get_crew()
        result = crew.generate_video_script(
            first_name=request.first_name,
            company_name=request.company_name,
            job_title=request.job_title,
            research_summary=request.research_summary,
            max_seconds=request.max_seconds,
            call_to_action=request.call_to_action,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


# ============================================================================
# Video Endpoints
# ============================================================================


@app.post("/video/generate", response_model=CrewResponse)
async def generate_video(request: GenerateVideoRequest):
    """Generate a HeyGen video"""
    if request.async_mode:
        job_id = await enqueue_video(
            phone_number=request.phone_number,
            script=request.script,
        )
        return CrewResponse(success=True, result="Job queued", job_id=job_id)

    try:
        crew = get_crew()
        result = crew.generate_video(
            phone_number=request.phone_number,
            script=request.script,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


# ============================================================================
# Voice Endpoints
# ============================================================================


@app.post("/voice/generate", response_model=CrewResponse)
async def generate_voice_message(request: GenerateVoiceRequest):
    """Generate an ElevenLabs voice message"""
    if request.async_mode:
        job_id = await enqueue_voice(
            phone_number=request.phone_number,
            script=request.script,
        )
        return CrewResponse(success=True, result="Job queued", job_id=job_id)

    try:
        crew = get_crew()
        result = crew.generate_voice_message(
            phone_number=request.phone_number,
            script=request.script,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


# ============================================================================
# CRM Endpoints
# ============================================================================


@app.post("/crm/sync", response_model=CrewResponse)
async def sync_to_crm(request: CRMSyncRequest):
    """Sync a contact to HubSpot CRM"""
    try:
        crew = get_crew()
        result = crew.sync_to_crm(
            phone_number=request.phone_number,
            first_name=request.first_name,
            last_name=request.last_name,
            email=request.email,
            company_name=request.company_name,
            job_title=request.job_title,
            create_deal=request.create_deal,
            deal_name=request.deal_name,
            note=request.note,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


# ============================================================================
# Pipeline Endpoints
# ============================================================================


@app.post("/pipeline/research-qualify", response_model=CrewResponse)
async def research_and_qualify(request: ResearchRequest):
    """Research a contact and qualify them in one workflow"""
    try:
        crew = get_crew()
        result = crew.research_and_qualify(
            phone_number=request.phone_number,
            email=request.email,
            linkedin_url=request.linkedin_url,
            first_name=request.first_name,
            last_name=request.last_name,
            company_name=request.company_name,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


@app.post("/pipeline/full", response_model=CrewResponse)
async def full_pipeline(request: FullPipelineRequest):
    """Run the full pipeline: research → qualify → personalize → CRM sync"""
    try:
        crew = get_crew()
        result = crew.full_pipeline(
            phone_number=request.phone_number,
            email=request.email,
            linkedin_url=request.linkedin_url,
            first_name=request.first_name,
            last_name=request.last_name,
            company_name=request.company_name,
            generate_video=request.generate_video,
            sync_to_crm=request.sync_to_crm,
        )
        return CrewResponse(success=True, result=str(result))
    except Exception as e:
        return CrewResponse(success=False, error=str(e))


# ============================================================================
# Configuration Endpoints
# ============================================================================


@app.get("/config")
async def get_config():
    """Get current configuration"""
    return {
        "llm_provider": os.getenv("LLM_PROVIDER", "anthropic/claude-sonnet-4-20250514"),
        "owner_name": os.getenv("OWNER_NAME", "the host"),
        "event_name": os.getenv("EVENT_NAME", "the event"),
        "pdl_configured": bool(os.getenv("PDL_API_KEY")),
        "heygen_configured": bool(os.getenv("HEYGEN_API_KEY")),
        "elevenlabs_configured": bool(os.getenv("ELEVENLABS_API_KEY")),
        "hubspot_configured": bool(os.getenv("HUBSPOT_API_KEY")),
        "supabase_configured": bool(os.getenv("SUPABASE_URL")),
        "whatsapp_configured": bool(os.getenv("WHATSAPP_ACCESS_TOKEN")),
        "redis_configured": bool(os.getenv("REDIS_URL")),
    }


@app.post("/config/llm")
async def set_llm_provider(provider: str):
    """Change the LLM provider at runtime"""
    global _crew
    os.environ["LLM_PROVIDER"] = provider
    _crew = None  # Reset crew to use new provider
    return {"status": "ok", "llm_provider": provider}


# ============================================================================
# Admin API Endpoints (for Frontend Dashboard)
# ============================================================================


@app.get("/admin/api/stats")
async def admin_get_stats():
    """Get contact statistics for dashboard"""
    if not _state_manager:
        return {"total": 0, "byStatus": {}, "byQualification": {}}

    try:
        phone_numbers = await _state_manager.list_active_conversations(1000)
        total = len(phone_numbers)

        by_status: dict[str, int] = {"active": 0, "inactive": 0}
        by_qualification: dict[str, int] = {"hot": 0, "warm": 0, "cold": 0, "unqualified": 0}

        for phone in phone_numbers[:100]:  # Sample first 100 for stats
            state = await _state_manager.get_state(phone)
            if state:
                # Determine status based on recent activity
                by_status["active"] += 1

                # Get qualification from state
                qual_data = state.qualification_data or {}
                tier = qual_data.get("tier", "unqualified")
                if tier in by_qualification:
                    by_qualification[tier] += 1
                else:
                    by_qualification["unqualified"] += 1

        return {
            "total": total,
            "byStatus": by_status,
            "byQualification": by_qualification,
        }
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        return {"total": 0, "byStatus": {}, "byQualification": {}}


@app.get("/admin/api/contacts")
async def admin_get_contacts(limit: int = Query(15, ge=1, le=100)):
    """Get recent contacts for dashboard"""
    if not _state_manager:
        return []

    try:
        phone_numbers = await _state_manager.list_active_conversations(limit)
        contacts = []

        for phone in phone_numbers:
            state = await _state_manager.get_state(phone)
            if state:
                qual_data = state.qualification_data or {}
                contacts.append({
                    "id": phone,
                    "phone_number": phone,
                    "first_name": state.first_name,
                    "last_name": state.last_name,
                    "email": state.email,
                    "company_name": state.company_name,
                    "job_title": state.job_title,
                    "status": "active" if state.conversation_turns > 0 else "new",
                    "qualification_tier": qual_data.get("tier"),
                    "created_at": state.created_at or "",
                    "updated_at": state.updated_at,
                })

        return contacts
    except Exception as e:
        logger.error(f"Error getting contacts: {e}")
        return []


@app.get("/admin/api/queues")
async def admin_get_queues():
    """Get queue statistics"""
    # ARQ doesn't have built-in queue stats, so we return placeholder data
    # In production, you'd query Redis for arq:queue:* keys
    return [
        {"name": "default", "waiting": 0, "active": 0, "completed": 0, "failed": 0, "delayed": 0},
        {"name": "research", "waiting": 0, "active": 0, "completed": 0, "failed": 0, "delayed": 0},
        {"name": "video", "waiting": 0, "active": 0, "completed": 0, "failed": 0, "delayed": 0},
    ]


@app.get("/admin/api/health")
async def admin_get_health():
    """Get detailed health status for dashboard"""
    import time

    redis_status = {"connected": False, "latencyMs": 0, "error": None}
    postgres_status = {"healthy": False, "latencyMs": 0, "error": None}

    # Check Redis
    if _state_manager and _state_manager._redis:
        try:
            start = time.time()
            await _state_manager._redis.ping()
            redis_status["connected"] = True
            redis_status["latencyMs"] = int((time.time() - start) * 1000)
        except Exception as e:
            redis_status["error"] = str(e)

    # Check Supabase (placeholder - would need actual Supabase client)
    postgres_status["healthy"] = bool(os.getenv("SUPABASE_URL"))

    return {
        "redis": redis_status,
        "postgres": postgres_status,
    }


@app.get("/admin/api/messages")
async def admin_get_messages(
    limit: int = Query(50, ge=1, le=500),
    phone: Optional[str] = None,
):
    """Get recent messages for dashboard"""
    if not _state_manager:
        return []

    try:
        messages = []

        if phone:
            # Get messages for specific contact
            history = await _state_manager.get_message_history(phone, limit)
            state = await _state_manager.get_state(phone)
            contact_name = state.first_name if state else None

            for msg in history:
                messages.append({
                    "id": msg.get("id", ""),
                    "contactId": phone,
                    "phoneNumber": phone,
                    "correlationId": phone,
                    "direction": "inbound" if msg.get("direction") == "incoming" else "outbound",
                    "channel": "whatsapp",
                    "messageType": msg.get("type", "text"),
                    "content": msg.get("content"),
                    "createdAt": msg.get("timestamp", ""),
                    "contactName": contact_name,
                })
        else:
            # Get messages across all contacts
            phone_numbers = await _state_manager.list_active_conversations(20)
            for p in phone_numbers:
                history = await _state_manager.get_message_history(p, 5)
                state = await _state_manager.get_state(p)
                contact_name = state.first_name if state else None

                for msg in history:
                    messages.append({
                        "id": msg.get("id", ""),
                        "contactId": p,
                        "phoneNumber": p,
                        "correlationId": p,
                        "direction": "inbound" if msg.get("direction") == "incoming" else "outbound",
                        "channel": "whatsapp",
                        "messageType": msg.get("type", "text"),
                        "content": msg.get("content"),
                        "createdAt": msg.get("timestamp", ""),
                        "contactName": contact_name,
                    })

            # Sort by timestamp and limit
            messages.sort(key=lambda x: x["createdAt"], reverse=True)
            messages = messages[:limit]

        return messages
    except Exception as e:
        logger.error(f"Error getting messages: {e}")
        return []


@app.get("/admin/api/activities")
async def admin_get_activities(
    limit: int = Query(20, ge=1, le=100),
    agentType: Optional[str] = None,
):
    """Get recent agent activities"""
    # This would track agent executions - placeholder for now
    return []


@app.get("/admin/api/swarm/states")
async def admin_get_swarm_states():
    """Get active swarm/conversation states"""
    if not _state_manager:
        return []

    try:
        phone_numbers = await _state_manager.list_active_conversations(50)
        states = []

        for phone in phone_numbers:
            state = await _state_manager.get_state(phone)
            if state:
                states.append({
                    "correlationId": phone,
                    "phoneNumber": phone,
                    "currentAgent": None,
                    "conversationTurns": state.conversation_turns,
                    "lastActivityAt": state.last_message_at or state.updated_at or "",
                    "taskQueueLength": 0,
                    "channel": "whatsapp",
                })

        return states
    except Exception as e:
        logger.error(f"Error getting swarm states: {e}")
        return []


@app.get("/admin/api/swarm/agents")
async def admin_get_agent_stats():
    """Get agent execution statistics from event log"""
    if not _blackboard or not _blackboard._pool:
        return [
            {"agentType": "research", "executions": 0, "avgDurationMs": 0, "successRate": 1.0},
            {"agentType": "qualification", "executions": 0, "avgDurationMs": 0, "successRate": 1.0},
            {"agentType": "personalization", "executions": 0, "avgDurationMs": 0, "successRate": 1.0},
            {"agentType": "video", "executions": 0, "avgDurationMs": 0, "successRate": 1.0},
            {"agentType": "voice", "executions": 0, "avgDurationMs": 0, "successRate": 1.0},
            {"agentType": "crm", "executions": 0, "avgDurationMs": 0, "successRate": 1.0},
        ]

    try:
        async with _blackboard._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT source_agent, COUNT(*) as count
                FROM swarm_event_log
                WHERE created_at > NOW() - INTERVAL '24 hours'
                GROUP BY source_agent
                """
            )
            stats = {row["source_agent"]: row["count"] for row in rows}

        return [
            {"agentType": agent, "executions": stats.get(agent, 0), "avgDurationMs": 0, "successRate": 1.0}
            for agent in ["research", "qualification", "personalization", "video", "voice", "crm"]
        ]
    except Exception as e:
        logger.error(f"Error getting agent stats: {e}")
        return []


@app.get("/admin/api/swarm/events")
async def admin_get_recent_events(limit: int = Query(50, ge=1, le=200)):
    """Get recent swarm events"""
    if not _blackboard or not _blackboard._pool:
        return []

    try:
        async with _blackboard._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT event_id, event_type, source_agent, contact_id, created_at
                FROM swarm_event_log
                ORDER BY created_at DESC
                LIMIT $1
                """,
                limit,
            )
            return [
                {
                    "eventId": row["event_id"],
                    "eventType": row["event_type"],
                    "sourceAgent": row["source_agent"],
                    "contactId": row["contact_id"],
                    "createdAt": str(row["created_at"]),
                }
                for row in rows
            ]
    except Exception as e:
        logger.error(f"Error getting events: {e}")
        return []


@app.post("/admin/api/swarm/trigger/{event_type}/{contact_id}")
async def admin_trigger_event(event_type: str, contact_id: str):
    """Manually trigger a swarm event"""
    if not _swarm_coordinator:
        return {"success": False, "error": "Swarm coordinator not initialized"}

    try:
        if event_type == "research":
            await _swarm_coordinator.request_research(contact_id)
        elif event_type == "qualification":
            await _swarm_coordinator.request_qualification(contact_id)
        elif event_type == "video":
            await _swarm_coordinator.request_video(contact_id)
        elif event_type == "voice":
            await _swarm_coordinator.request_voice(contact_id)
        elif event_type == "crm":
            await _swarm_coordinator.request_crm_sync(contact_id)
        else:
            return {"success": False, "error": f"Unknown event type: {event_type}"}

        return {"success": True, "eventType": event_type, "contactId": contact_id}
    except Exception as e:
        logger.error(f"Error triggering event: {e}")
        return {"success": False, "error": str(e)}


@app.post("/admin/api/send-voice/{contact_id}")
async def admin_send_voice(contact_id: str):
    """Trigger voice message generation for a contact"""
    try:
        state = await _state_manager.get_state(contact_id) if _state_manager else None
        if not state:
            return {"success": False, "error": "Contact not found"}

        # Generate a script and enqueue voice generation
        crew = get_crew()
        script = crew.generate_welcome_message(
            first_name=state.first_name or "there",
            company_name=state.company_name,
            job_title=state.job_title,
        )

        job_id = await enqueue_voice(contact_id, str(script))
        return {"success": True, "jobId": job_id}
    except Exception as e:
        logger.error(f"Error sending voice: {e}")
        return {"success": False, "error": str(e)}


@app.post("/admin/api/send-video/{contact_id}")
async def admin_send_video(contact_id: str):
    """Trigger video generation for a contact"""
    try:
        state = await _state_manager.get_state(contact_id) if _state_manager else None
        if not state:
            return {"success": False, "error": "Contact not found"}

        # Generate a script and enqueue video generation
        crew = get_crew()
        script = crew.generate_video_script(
            first_name=state.first_name or "there",
            company_name=state.company_name,
            job_title=state.job_title,
        )

        job_id = await enqueue_video(contact_id, str(script))
        return {"success": True, "jobId": job_id}
    except Exception as e:
        logger.error(f"Error sending video: {e}")
        return {"success": False, "error": str(e)}


# ============================================================================
# WhatsApp Bridge Endpoint (for Baileys/QR code connection)
# ============================================================================


class BridgeMessageRequest(BaseModel):
    """Incoming message from WhatsApp bridge"""

    phone_number: str
    message_id: str
    message_type: str = "text"
    content: str = ""
    push_name: Optional[str] = None
    media_id: Optional[str] = None


@app.post("/bridge/message")
async def bridge_receive_message(request: BridgeMessageRequest):
    """
    Receive a message from the WhatsApp bridge and return a response.

    Uses the swarm coordinator to publish events and generate immediate responses.
    Agents process events asynchronously via Redis Streams.
    """
    logger.info(f"Bridge received message from {request.phone_number}: {request.content[:50]}...")

    try:
        if not _swarm_coordinator:
            raise ValueError("Swarm coordinator not initialized")

        # Process message through swarm coordinator
        # This publishes events for agents and returns immediate response for new contacts
        response = await _swarm_coordinator.handle_incoming_message(
            phone_number=request.phone_number,
            message_text=request.content,
            message_type=request.message_type,
            push_name=request.push_name,
            message_id=request.message_id,
        )

        logger.info(f"Bridge response for {request.phone_number}: {response[:50] if response else 'None'}...")

        return {"success": True, "response": response}

    except Exception as e:
        logger.error(f"Bridge message processing failed: {e}")
        return {"success": False, "error": str(e), "response": None}


# ============================================================================
# Static File Serving for Frontend
# ============================================================================

# Path to the frontend build directory
FRONTEND_DIR = Path(os.getenv(
    "FRONTEND_DIR",
    "/Users/michaelfriedberg/PhpstormProjects/nexthello/dist/src/admin"
))


@app.get("/admin/{full_path:path}")
async def serve_admin_frontend(full_path: str):
    """Serve the admin frontend SPA"""
    # Check if requesting a static asset
    file_path = FRONTEND_DIR / full_path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)

    # For all other routes, serve index.html (SPA routing)
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)

    return {"error": f"Frontend not found at {FRONTEND_DIR}. Run: cd src/admin/frontend && npm run build"}


# Mount static assets directory
if FRONTEND_DIR.exists():
    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.exists():
        app.mount("/admin/assets", StaticFiles(directory=str(assets_dir)), name="admin-assets")
