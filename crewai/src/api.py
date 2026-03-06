"""
NextHello CrewAI API

Complete FastAPI application with:
- WhatsApp Cloud API webhooks
- CrewAI agent endpoints
- State management
- Background job queue
"""

import asyncio
import json
import logging
import os
import shutil
import urllib.error
import urllib.request
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    HTTPException,
    BackgroundTasks,
    Request,
    Response,
    Query,
    UploadFile,
    File,
)
from fastapi.responses import FileResponse, StreamingResponse
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

PROJECT_ROOT = Path(__file__).resolve().parents[2]
GREETING_VIDEO_DIR = PROJECT_ROOT / "storage" / "greeting-video"
GREETING_VIDEO_METADATA_PATH = GREETING_VIDEO_DIR / "metadata.json"
WHATSAPP_CONNECTOR_URL = os.getenv("WHATSAPP_CONNECTOR_URL", "http://whatsapp:3000")


def _fetch_connector_json(path: str) -> dict[str, Any]:
    url = f"{WHATSAPP_CONNECTOR_URL}{path}"
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Connector returned HTTP {e.code} for {path}",
        )
    except urllib.error.URLError:
        raise HTTPException(
            status_code=503,
            detail="WhatsApp connector is unavailable",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse connector response: {e}",
        )


def _post_connector_json(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{WHATSAPP_CONNECTOR_URL}{path}"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = f"Connector returned HTTP {e.code} for {path}"
        try:
            raw = e.read().decode("utf-8")
            if raw:
                parsed = json.loads(raw)
                detail = parsed.get("error") or parsed.get("message") or detail
        except Exception:
            pass
        raise HTTPException(status_code=502, detail=detail)
    except urllib.error.URLError:
        raise HTTPException(status_code=503, detail="WhatsApp connector is unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse connector response: {e}")


def _normalize_history_message_type(message_type: Optional[str]) -> str:
    allowed = {"text", "image", "video", "audio", "document", "sticker", "location"}
    normalized = (message_type or "text").lower()
    return normalized if normalized in allowed else "text"


async def _persist_message_history(
    phone_number: str,
    correlation_id: str,
    direction: str,
    message_type: str,
    content: str,
) -> None:
    """Persist message to PostgreSQL message_history when available."""
    if not _blackboard or not _blackboard._pool:
        logger.warning(
            "Skipping message_history persistence: PostgreSQL pool unavailable",
            extra={
                "phone_number": phone_number,
                "correlation_id": correlation_id,
                "direction": direction,
                "message_type": message_type,
            },
        )
        return

    db_direction = "inbound" if direction == "incoming" else "outbound"
    db_message_type = _normalize_history_message_type(message_type)

    try:
        logger.info(
            "Persisting message_history row",
            extra={
                "phone_number": phone_number,
                "correlation_id": correlation_id,
                "direction": db_direction,
                "message_type": db_message_type,
                "content_length": len(content or ""),
            },
        )
        async with _blackboard._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id FROM networking_contacts WHERE phone_number = $1 LIMIT 1",
                phone_number,
            )
            contact_id = row["id"] if row else None

            await conn.execute(
                """
                INSERT INTO message_history (
                    contact_id, phone_number, correlation_id,
                    direction, channel, message_type, content
                ) VALUES ($1, $2, $3, $4, 'whatsapp', $5, $6)
                """,
                contact_id,
                phone_number,
                correlation_id,
                db_direction,
                db_message_type,
                content,
            )
        logger.info(
            "Persisted message_history row",
            extra={
                "phone_number": phone_number,
                "correlation_id": correlation_id,
                "direction": db_direction,
            },
        )
    except Exception as e:
        logger.exception(
            "Failed to persist message_history row",
            extra={
                "phone_number": phone_number,
                "correlation_id": correlation_id,
                "direction": db_direction,
                "message_type": db_message_type,
            },
        )


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


def _contact_response_from_blackboard(state) -> dict[str, Any]:
    return {
        "id": state.phone_number,
        "phone_number": state.phone_number,
        "first_name": state.first_name,
        "last_name": state.last_name,
        "email": state.email,
        "company_name": state.company_name,
        "job_title": state.job_title,
        "status": "active" if state.conversation_turns > 0 else "new",
        "qualification_tier": state.qualification_tier,
        "created_at": state.created_at or "",
        "updated_at": state.updated_at,
    }


def _contact_response_from_redis(state: ConversationState) -> dict[str, Any]:
    qual_data = state.qualification_data or {}
    return {
        "id": state.phone_number,
        "phone_number": state.phone_number,
        "first_name": state.first_name,
        "last_name": state.last_name,
        "email": state.email,
        "company_name": state.company_name,
        "job_title": state.job_title,
        "status": "active" if state.conversation_turns > 0 else "new",
        "qualification_tier": qual_data.get("tier"),
        "created_at": state.created_at or "",
        "updated_at": state.updated_at,
    }


async def _get_db_contact_row(contact_id: str):
    if not _blackboard or not _blackboard._pool:
        return None

    async with _blackboard._pool.acquire() as conn:
        return await conn.fetchrow(
            """
            SELECT *
            FROM networking_contacts
            WHERE phone_number = $1 OR id::text = $1
            LIMIT 1
            """,
            contact_id,
        )


async def _get_contact_payload(contact_id: str) -> Optional[dict[str, Any]]:
    if _blackboard:
        blackboard_state = await _blackboard.get_contact(contact_id)
        if blackboard_state:
            return _contact_response_from_blackboard(blackboard_state)

    if _state_manager:
        redis_state = await _state_manager.get_state(contact_id)
        if redis_state:
            return _contact_response_from_redis(redis_state)

    row = await _get_db_contact_row(contact_id)
    if row and _blackboard:
        return _contact_response_from_blackboard(_blackboard._row_to_state(dict(row)))

    return None


async def _list_contacts_payload(limit: int) -> list[dict[str, Any]]:
    if _blackboard:
        contacts = await _blackboard.list_contacts(limit=limit)
        if contacts:
            return [_contact_response_from_blackboard(contact) for contact in contacts]

    if not _state_manager:
        return []

    phone_numbers = await _state_manager.list_active_conversations(limit)
    contacts = []
    for phone in phone_numbers:
        state = await _state_manager.get_state(phone)
        if state:
            contacts.append(_contact_response_from_redis(state))
    return contacts


async def _list_swarm_states_payload(limit: int = 50) -> list[dict[str, Any]]:
    states = []

    if _blackboard:
        contacts = await _blackboard.list_contacts(limit=limit)
        if contacts:
            for contact in contacts:
                states.append(
                    {
                        "correlationId": contact.phone_number,
                        "phoneNumber": contact.phone_number,
                        "currentAgent": None,
                        "conversationTurns": contact.conversation_turns,
                        "lastActivityAt": contact.last_message_at
                        or contact.updated_at
                        or contact.created_at
                        or "",
                        "taskQueueLength": len(contact.pending_actions or {}),
                        "channel": "whatsapp",
                    }
                )
            return states

    if not _state_manager:
        return []

    phone_numbers = await _state_manager.list_active_conversations(limit)
    for phone in phone_numbers:
        state = await _state_manager.get_state(phone)
        if state:
            states.append(
                {
                    "correlationId": phone,
                    "phoneNumber": phone,
                    "currentAgent": None,
                    "conversationTurns": state.conversation_turns,
                    "lastActivityAt": state.last_message_at
                    or state.updated_at
                    or state.created_at
                    or "",
                    "taskQueueLength": 0,
                    "channel": "whatsapp",
                }
            )

    return states


async def _query_agent_activities(
    limit: int = 20,
    agent_type: Optional[str] = None,
    contact_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    if not _blackboard or not _blackboard._pool:
        return []

    params: list[Any] = []
    conditions: list[str] = []

    if agent_type:
        params.append(agent_type)
        conditions.append(f"agent_type = ${len(params)}")

    if contact_id:
        params.append(contact_id)
        conditions.append(
            f"(correlation_id = ${len(params)} OR contact_id = (SELECT id FROM networking_contacts WHERE phone_number = ${len(params)} OR id::text = ${len(params)} LIMIT 1))"
        )

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    params.append(limit)

    async with _blackboard._pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, correlation_id, agent_type, action, status, started_at,
                   completed_at, duration_ms, input_tokens, output_tokens, error_message
            FROM agent_activity_log
            {where_clause}
            ORDER BY started_at DESC
            LIMIT ${len(params)}
            """,
            *params,
        )

    return [
        {
            "id": str(row["id"]),
            "correlationId": row["correlation_id"],
            "agentType": row["agent_type"],
            "action": row["action"],
            "status": row["status"] or "started",
            "startedAt": str(row["started_at"]),
            "completedAt": str(row["completed_at"]) if row["completed_at"] else None,
            "durationMs": row["duration_ms"],
            "inputTokens": row["input_tokens"],
            "outputTokens": row["output_tokens"],
            "metadata": {"errorMessage": row["error_message"]} if row["error_message"] else None,
        }
        for row in rows
    ]


def _load_greeting_video_metadata() -> Optional[dict[str, Any]]:
    if not GREETING_VIDEO_METADATA_PATH.exists():
        return None

    try:
        return json.loads(GREETING_VIDEO_METADATA_PATH.read_text())
    except json.JSONDecodeError:
        return None


def _get_greeting_video_file_path(metadata: Optional[dict[str, Any]]) -> Optional[Path]:
    if not metadata:
        return None

    filename = metadata.get("filename")
    if not filename:
        return None

    file_path = GREETING_VIDEO_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        return None

    return file_path


def _get_greeting_video_info() -> dict[str, Any]:
    metadata = _load_greeting_video_metadata()
    file_path = _get_greeting_video_file_path(metadata)

    if not metadata or not file_path:
        return {"exists": False}

    return {
        "exists": True,
        "storageKey": str(file_path.relative_to(PROJECT_ROOT)),
        "filename": metadata.get("filename"),
        "sizeBytes": metadata.get("sizeBytes", file_path.stat().st_size),
        "uploadedAt": metadata.get("uploadedAt"),
        "url": "/admin/api/settings/greeting-video/file",
    }


async def _build_swarm_snapshot() -> dict[str, Any]:
    return {
        "type": "state:sync",
        "timestamp": datetime.utcnow().isoformat(),
        "data": {
            "activities": await _query_agent_activities(limit=20),
            "states": await _list_swarm_states_payload(limit=50),
        },
    }


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
            result = await _whatsapp_client.send_audio(
                request.phone_number, audio_url=request.media_url
            )
        elif request.message_type == "video":
            result = await _whatsapp_client.send_video(
                request.phone_number, video_url=request.media_url, caption=request.content
            )
        else:
            result = await _whatsapp_client.send_text(request.phone_number, request.content)

        # Record outbound message
        if _state_manager:
            await _state_manager.add_message(
                phone_number=request.phone_number,
                message_id=str(uuid.uuid4()),
                direction="outgoing",
                message_type=request.message_type,
                content=request.content,
                media_url=request.media_url,
            )

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
    try:
        contacts = await _list_contacts_payload(1000)
        total = len(contacts)

        by_status: dict[str, int] = {"active": 0, "inactive": 0, "new": 0}
        by_qualification: dict[str, int] = {"hot": 0, "warm": 0, "cold": 0, "unqualified": 0}

        for contact in contacts:
            status = contact.get("status") or "inactive"
            by_status[status] = by_status.get(status, 0) + 1

            tier = contact.get("qualification_tier") or "unqualified"
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
    try:
        return await _list_contacts_payload(limit)
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


@app.get("/admin/api/whatsapp/connector")
async def admin_get_whatsapp_connector():
    """Get WhatsApp connector status and current QR payload."""
    health = _fetch_connector_json("/health")
    session = _fetch_connector_json("/session/status")
    qr = _fetch_connector_json("/qr")

    return {
        "available": True,
        "connected": bool(health.get("connected")),
        "sessionId": health.get("sessionId") or session.get("sessionId"),
        "postgresConfigured": bool(session.get("postgresConfigured")),
        "hasRemoteSession": bool(session.get("hasRemote")),
        "remoteFormat": session.get("remoteFormat"),
        "hasLocalSession": bool(session.get("hasLocal")),
        "qrAvailable": bool(qr.get("available")),
        "qrText": qr.get("qrText"),
    }


class AdminWhatsAppSendRequest(BaseModel):
    phone_number: str
    content: str


@app.post("/admin/api/whatsapp/send")
async def admin_send_whatsapp_message(request: AdminWhatsAppSendRequest):
    """Send a WhatsApp message through connector and persist an outbound row."""
    phone_number = "".join(ch for ch in (request.phone_number or "") if ch.isdigit())
    content = (request.content or "").strip()

    if not phone_number:
        raise HTTPException(status_code=400, detail="phone_number is required")
    if not content:
        raise HTTPException(status_code=400, detail="content is required")

    connector_result = _post_connector_json(
        "/send",
        {
            "to": phone_number,
            "message": content,
        },
    )
    if not connector_result.get("success"):
        raise HTTPException(status_code=502, detail="Connector failed to send message")

    connector_via = connector_result.get("via") or "unknown"
    connector_to = connector_result.get("to")
    connector_message_id = connector_result.get("messageId")

    correlation_id = f"manual-outbound-{uuid.uuid4()}"
    await _persist_message_history(
        phone_number=phone_number,
        correlation_id=correlation_id,
        direction="outgoing",
        message_type="text",
        content=content,
    )

    if _state_manager:
        await _state_manager.add_message(
            phone_number=phone_number,
            message_id=correlation_id,
            direction="outgoing",
            message_type="text",
            content=content,
        )

    return {
        "success": True,
        "phoneNumber": phone_number,
        "correlationId": correlation_id,
        "via": connector_via,
        "to": connector_to,
        "messageId": connector_message_id,
    }


@app.get("/admin/api/whatsapp/messages/persisted")
async def admin_get_persisted_whatsapp_messages(
    phone: Optional[str] = None,
    direction: Optional[str] = Query(None, pattern="^(inbound|outbound)$"),
    since: Optional[str] = None,
    limit: int = Query(20, ge=1, le=200),
):
    """Query persisted WhatsApp messages directly from PostgreSQL."""
    if not _blackboard or not _blackboard._pool:
        raise HTTPException(status_code=503, detail="PostgreSQL persistence is unavailable")

    clauses: list[str] = ["channel = 'whatsapp'"]
    params: list[Any] = []

    if phone:
        clauses.append(f"phone_number = ${len(params) + 1}")
        params.append(phone)

    if direction:
        clauses.append(f"direction = ${len(params) + 1}")
        params.append(direction)

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid 'since' timestamp format")
        clauses.append(f"created_at >= ${len(params) + 1}")
        params.append(since_dt)

    where_sql = " AND ".join(clauses)
    query = f"""
        SELECT id, phone_number, correlation_id, direction, message_type, content, created_at
        FROM message_history
        WHERE {where_sql}
        ORDER BY created_at DESC
        LIMIT ${len(params) + 1}
    """
    params.append(limit)

    async with _blackboard._pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    items = [
        {
            "id": str(row["id"]),
            "phoneNumber": row["phone_number"],
            "correlationId": row["correlation_id"],
            "direction": row["direction"],
            "messageType": row["message_type"],
            "content": row["content"] or "",
            "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
        }
        for row in rows
    ]

    return {"count": len(items), "items": items}


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
                messages.append(
                    {
                        "id": msg.get("id", ""),
                        "contactId": phone,
                        "phoneNumber": phone,
                        "correlationId": phone,
                        "direction": "inbound"
                        if msg.get("direction") == "incoming"
                        else "outbound",
                        "channel": "whatsapp",
                        "messageType": msg.get("type", "text"),
                        "content": msg.get("content"),
                        "createdAt": msg.get("timestamp", ""),
                        "contactName": contact_name,
                    }
                )
        else:
            # Get messages across all contacts
            phone_numbers = await _state_manager.list_active_conversations(20)
            for p in phone_numbers:
                history = await _state_manager.get_message_history(p, 5)
                state = await _state_manager.get_state(p)
                contact_name = state.first_name if state else None

                for msg in history:
                    messages.append(
                        {
                            "id": msg.get("id", ""),
                            "contactId": p,
                            "phoneNumber": p,
                            "correlationId": p,
                            "direction": "inbound"
                            if msg.get("direction") == "incoming"
                            else "outbound",
                            "channel": "whatsapp",
                            "messageType": msg.get("type", "text"),
                            "content": msg.get("content"),
                            "createdAt": msg.get("timestamp", ""),
                            "contactName": contact_name,
                        }
                    )

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
    try:
        return await _query_agent_activities(limit=limit, agent_type=agentType)
    except Exception as e:
        logger.error(f"Error getting activities: {e}")
        return []


@app.get("/admin/api/swarm/states")
async def admin_get_swarm_states():
    """Get active swarm/conversation states"""
    try:
        return await _list_swarm_states_payload(limit=50)
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
            {
                "agentType": "personalization",
                "executions": 0,
                "avgDurationMs": 0,
                "successRate": 1.0,
            },
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
            {
                "agentType": agent,
                "executions": stats.get(agent, 0),
                "avgDurationMs": 0,
                "successRate": 1.0,
            }
            for agent in ["research", "qualification", "personalization", "video", "voice", "crm"]
        ]
    except Exception as e:
        logger.error(f"Error getting agent stats: {e}")
        return []


@app.get("/admin/api/swarm/events")
async def admin_get_recent_events(request: Request):
    """Stream swarm state to the admin dashboard via SSE."""

    async def event_stream():
        yield "event: connected\ndata: {}\n\n"

        while True:
            if await request.is_disconnected():
                break

            payload = await _build_swarm_snapshot()
            yield f"event: state:sync\ndata: {json.dumps(payload)}\n\n"
            await asyncio.sleep(5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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
        contact = await _get_contact_payload(contact_id)
        if not contact:
            return {"success": False, "error": "Contact not found"}

        # Generate a script and enqueue voice generation
        crew = get_crew()
        script = crew.generate_welcome_message(
            first_name=contact.get("first_name") or "there",
            company_name=contact.get("company_name"),
            job_title=contact.get("job_title"),
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
        contact = await _get_contact_payload(contact_id)
        if not contact:
            return {"success": False, "error": "Contact not found"}

        # Generate a script and enqueue video generation
        crew = get_crew()
        script = crew.generate_video_script(
            first_name=contact.get("first_name") or "there",
            company_name=contact.get("company_name"),
            job_title=contact.get("job_title"),
        )

        job_id = await enqueue_video(contact_id, str(script))
        return {"success": True, "jobId": job_id}
    except Exception as e:
        logger.error(f"Error sending video: {e}")
        return {"success": False, "error": str(e)}


@app.get("/admin/api/contacts/{contact_id}")
async def admin_get_contact(contact_id: str):
    """Get a single contact for the admin detail view."""
    try:
        return await _get_contact_payload(contact_id)
    except Exception as e:
        logger.error(f"Error getting contact {contact_id}: {e}")
        return None


@app.get("/admin/api/contacts/{contact_id}/messages")
async def admin_get_contact_messages(contact_id: str, limit: int = Query(50, ge=1, le=500)):
    """Get messages for a single contact."""
    return await admin_get_messages(limit=limit, phone=contact_id)


@app.get("/admin/api/contacts/{contact_id}/activities")
async def admin_get_contact_activities(contact_id: str, limit: int = Query(50, ge=1, le=200)):
    """Get agent activity for a single contact."""
    try:
        return await _query_agent_activities(limit=limit, contact_id=contact_id)
    except Exception as e:
        logger.error(f"Error getting activities for {contact_id}: {e}")
        return []


@app.get("/admin/api/contacts/{contact_id}/enrichment")
async def admin_get_contact_enrichment(contact_id: str):
    """Get latest PDL enrichment for a contact."""
    row = await _get_db_contact_row(contact_id)
    if not row or not _blackboard or not _blackboard._pool:
        return None

    async with _blackboard._pool.acquire() as conn:
        enrichment = await conn.fetchrow(
            """
            SELECT *
            FROM pdl_person_enrichment
            WHERE contact_id = $1
            ORDER BY enriched_at DESC NULLS LAST, created_at DESC
            LIMIT 1
            """,
            row["id"],
        )

    if not enrichment:
        return None

    data = dict(enrichment)
    return {
        "id": str(data.get("id")),
        "contactId": str(data.get("contact_id")),
        "pdlId": data.get("pdl_id"),
        "likelihood": data.get("likelihood"),
        "matchedOn": data.get("matched_on"),
        "fullName": data.get("full_name"),
        "firstName": data.get("first_name"),
        "lastName": data.get("last_name"),
        "workEmail": data.get("work_email"),
        "personalEmails": data.get("personal_emails"),
        "mobilePhone": data.get("mobile_phone"),
        "jobTitle": data.get("job_title"),
        "jobTitleRole": data.get("job_title_role"),
        "jobTitleLevels": data.get("job_title_levels"),
        "jobStartDate": str(data.get("job_start_date")) if data.get("job_start_date") else None,
        "inferredSalary": data.get("inferred_salary"),
        "inferredYearsExperience": data.get("inferred_years_experience"),
        "jobCompanyName": data.get("job_company_name"),
        "jobCompanyWebsite": data.get("job_company_website"),
        "jobCompanyLinkedinUrl": data.get("job_company_linkedin_url"),
        "jobCompanySize": data.get("job_company_size"),
        "jobCompanyIndustry": data.get("job_company_industry"),
        "jobCompanyType": data.get("job_company_type"),
        "jobCompanyEmployeeCount": data.get("job_company_employee_count"),
        "jobCompanyInferredRevenue": data.get("job_company_inferred_revenue"),
        "locationName": data.get("location_name"),
        "locationLocality": data.get("location_locality"),
        "locationRegion": data.get("location_region"),
        "locationCountry": data.get("location_country"),
        "linkedinUrl": data.get("linkedin_url"),
        "linkedinId": data.get("linkedin_id"),
        "linkedinUsername": data.get("linkedin_username"),
        "linkedinConnections": data.get("linkedin_connections"),
        "twitterUrl": data.get("twitter_url"),
        "twitterUsername": data.get("twitter_username"),
        "githubUrl": data.get("github_url"),
        "githubUsername": data.get("github_username"),
        "facebookUrl": data.get("facebook_url"),
        "experience": data.get("experience"),
        "education": data.get("education"),
        "skills": data.get("skills"),
        "interests": data.get("interests"),
        "enrichedAt": str(data.get("enriched_at")) if data.get("enriched_at") else None,
    }


@app.get("/admin/api/contacts/{contact_id}/luma")
async def admin_get_contact_luma(contact_id: str):
    """Get Luma guest and event associations for a contact."""
    row = await _get_db_contact_row(contact_id)
    if not row or not _blackboard or not _blackboard._pool:
        return {"guest": None, "events": []}

    async with _blackboard._pool.acquire() as conn:
        guest = await conn.fetchrow(
            """
            SELECT g.*
            FROM contact_luma_associations cla
            JOIN luma_guests g ON g.id = cla.guest_id
            WHERE cla.contact_id = $1
            ORDER BY cla.created_at DESC
            LIMIT 1
            """,
            row["id"],
        )

        events = await conn.fetch(
            """
            SELECT e.*, leg.is_featured, leg.is_host
            FROM contact_luma_associations cla
            JOIN luma_event_guests leg ON leg.guest_id = cla.guest_id
            JOIN luma_events e ON e.id = leg.event_id
            WHERE cla.contact_id = $1
            ORDER BY e.event_date DESC NULLS LAST, e.created_at DESC
            """,
            row["id"],
        )

    guest_payload = None
    if guest:
        guest_payload = {
            "id": str(guest["id"]),
            "lumaUserId": guest["luma_user_id"],
            "lumaProfileUrl": guest["luma_profile_url"],
            "name": guest["name"],
            "bio": guest["bio"],
            "instagramUrl": guest["instagram_url"],
            "twitterUrl": guest["twitter_url"],
            "linkedinUrl": guest["linkedin_url"],
            "websiteUrl": guest["website_url"],
            "instagramHandle": guest["instagram_handle"],
            "twitterHandle": guest["twitter_handle"],
        }

    return {
        "guest": guest_payload,
        "events": [
            {
                "id": str(event["id"]),
                "slug": event["slug"],
                "name": event["name"],
                "url": event["url"],
                "eventDate": str(event["event_date"]) if event["event_date"] else None,
                "location": event["location"],
                "isOnline": event["is_online"],
                "hostName": event["host_name"],
                "guestCount": event["guest_count"] or 0,
                "isFeatured": event["is_featured"],
                "isHost": event["is_host"],
            }
            for event in events
        ],
    }


@app.get("/admin/api/contacts/{contact_id}/media")
async def admin_get_contact_media(contact_id: str):
    """Get tracked media files for a contact."""
    row = await _get_db_contact_row(contact_id)
    if not row or not _blackboard or not _blackboard._pool:
        return []

    async with _blackboard._pool.acquire() as conn:
        files = await conn.fetch(
            """
            SELECT id, storage_key, media_type, mime_type, size_bytes, source, source_url, created_at
            FROM media_files
            WHERE (contact_id = $1 OR phone_number = $2)
              AND deleted_at IS NULL
            ORDER BY created_at DESC
            """,
            row["id"],
            row["phone_number"],
        )

    payload = []
    for media in files:
        url = media["source_url"] or f"/admin/api/media/{media['id']}"
        payload.append(
            {
                "id": str(media["id"]),
                "storageKey": media["storage_key"],
                "mediaType": media["media_type"],
                "mimeType": media["mime_type"],
                "sizeBytes": media["size_bytes"],
                "source": media["source"],
                "createdAt": str(media["created_at"]),
                "url": url,
            }
        )

    return payload


@app.get("/admin/api/media/{media_id}")
async def admin_get_media_file(media_id: str):
    """Serve a tracked local media file if present on disk."""
    if not _blackboard or not _blackboard._pool:
        raise HTTPException(status_code=404, detail="Media not found")

    async with _blackboard._pool.acquire() as conn:
        media = await conn.fetchrow(
            """
            SELECT storage_key, mime_type
            FROM media_files
            WHERE id::text = $1 AND deleted_at IS NULL
            LIMIT 1
            """,
            media_id,
        )

    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    file_path = PROJECT_ROOT / media["storage_key"]
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Media file missing on disk")

    return FileResponse(file_path, media_type=media["mime_type"])


@app.get("/admin/api/settings/greeting-video")
async def admin_get_greeting_video():
    """Return greeting video metadata for the settings page."""
    return _get_greeting_video_info()


@app.get("/admin/api/settings/greeting-video/file")
async def admin_get_greeting_video_file():
    """Serve the current greeting video."""
    metadata = _load_greeting_video_metadata()
    file_path = _get_greeting_video_file_path(metadata)
    if not file_path:
        raise HTTPException(status_code=404, detail="Greeting video not found")

    return FileResponse(file_path)


@app.post("/admin/api/settings/greeting-video")
async def admin_upload_greeting_video(video: UploadFile = File(...)):
    """Upload or replace the greeting video."""
    if not video.content_type or not video.content_type.startswith("video/"):
        raise HTTPException(status_code=400, detail="Please upload a valid video file")

    filename = video.filename or "greeting-video.mp4"

    GREETING_VIDEO_DIR.mkdir(parents=True, exist_ok=True)

    for existing in GREETING_VIDEO_DIR.iterdir():
        if existing.is_file():
            existing.unlink()

    target_path = GREETING_VIDEO_DIR / filename
    with target_path.open("wb") as buffer:
        shutil.copyfileobj(video.file, buffer)

    metadata = {
        "filename": filename,
        "sizeBytes": target_path.stat().st_size,
        "uploadedAt": datetime.utcnow().isoformat(),
    }
    GREETING_VIDEO_METADATA_PATH.write_text(json.dumps(metadata))

    return {"success": True}


@app.delete("/admin/api/settings/greeting-video")
async def admin_delete_greeting_video():
    """Delete the current greeting video and metadata."""
    info = _get_greeting_video_info()
    if not info.get("exists"):
        return {"success": True}

    metadata = _load_greeting_video_metadata()
    file_path = _get_greeting_video_file_path(metadata)
    if file_path and file_path.exists():
        file_path.unlink()
    if GREETING_VIDEO_METADATA_PATH.exists():
        GREETING_VIDEO_METADATA_PATH.unlink()

    return {"success": True}


# ============================================================================
# WhatsApp Connector Endpoint (for Baileys/QR code connection)
# ============================================================================


class WhatsAppConnectorMessageRequest(BaseModel):
    """Incoming message from WhatsApp connector"""

    phone_number: str
    message_id: str
    message_type: str = "text"
    content: str = ""
    push_name: Optional[str] = None
    media_id: Optional[str] = None


@app.post("/whatsapp/message")
async def whatsapp_receive_message(request: WhatsAppConnectorMessageRequest):
    """
    Receive a message from the WhatsApp connector and return a response.

    Uses the swarm coordinator to publish events and generate immediate responses.
    Agents process events asynchronously via Redis Streams.
    """
    logger.info(
        f"WhatsApp connector received message from {request.phone_number}: {request.content[:50]}..."
    )
    logger.info(
        "Inbound connector payload accepted",
        extra={
            "phone_number": request.phone_number,
            "message_id": request.message_id,
            "message_type": request.message_type,
            "content_length": len(request.content or ""),
        },
    )

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

        await _persist_message_history(
            phone_number=request.phone_number,
            correlation_id=request.message_id,
            direction="incoming",
            message_type=request.message_type,
            content=request.content,
        )
        logger.info(
            "Inbound message persistence call completed",
            extra={
                "phone_number": request.phone_number,
                "message_id": request.message_id,
            },
        )

        auto_reply_id: Optional[str] = None

        # Record inbound message
        if _state_manager:
            await _state_manager.add_message(
                phone_number=request.phone_number,
                message_id=request.message_id,
                direction="incoming",
                message_type=request.message_type,
                content=request.content,
            )
        else:
            logger.warning(
                "State manager unavailable while recording inbound message",
                extra={
                    "phone_number": request.phone_number,
                    "message_id": request.message_id,
                },
            )

            # Record outbound auto-reply if one was generated
            if response:
                auto_reply_id = f"auto-reply-{request.message_id}"
                await _state_manager.add_message(
                    phone_number=request.phone_number,
                    message_id=auto_reply_id,
                    direction="outgoing",
                    message_type="text",
                    content=response,
                )

        if response:
            await _persist_message_history(
                phone_number=request.phone_number,
                correlation_id=auto_reply_id or f"auto-reply-{request.message_id}",
                direction="outgoing",
                message_type="text",
                content=response,
            )

        logger.info(
            f"WhatsApp connector response for {request.phone_number}: {response[:50] if response else 'None'}..."
        )

        return {"success": True, "response": response}

    except Exception as e:
        logger.error(f"WhatsApp connector message processing failed: {e}")
        return {"success": False, "error": str(e), "response": None}
