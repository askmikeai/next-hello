"""
Job Queue - Job Definitions and Enqueueing

Uses ARQ for async Redis-based job queue.
"""

import os
from enum import Enum
from typing import Optional, Any
from arq import create_pool
from arq.connections import RedisSettings


class JobType(str, Enum):
    """Available job types"""

    RESEARCH_CONTACT = "research_contact"
    QUALIFY_LEAD = "qualify_lead"
    GENERATE_VIDEO = "generate_video"
    GENERATE_VOICE = "generate_voice"
    SYNC_CRM = "sync_crm"
    FULL_PIPELINE = "full_pipeline"
    SEND_MESSAGE = "send_message"
    TRANSCRIBE_AUDIO = "transcribe_audio"
    PROCESS_INCOMING = "process_incoming_message"


def get_redis_settings() -> RedisSettings:
    """Get Redis settings from environment"""
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")

    # Parse redis URL: redis://host:port/database
    host = "localhost"
    port = 6379
    database = 0

    if redis_url.startswith("redis://"):
        url_part = redis_url.replace("redis://", "")

        # Split database from host:port
        if "/" in url_part:
            host_port, db_str = url_part.rsplit("/", 1)
            database = int(db_str) if db_str else 0
        else:
            host_port = url_part

        # Split host and port
        if ":" in host_port:
            host, port_str = host_port.split(":", 1)
            port = int(port_str) if port_str else 6379
        else:
            host = host_port

    return RedisSettings(
        host=host,
        port=port,
        database=database,
    )


async def enqueue_job(
    job_type: JobType,
    phone_number: str,
    data: Optional[dict] = None,
    delay_seconds: int = 0,
    job_id: Optional[str] = None,
) -> str:
    """
    Enqueue a job to be processed by the worker.

    Args:
        job_type: Type of job to run
        phone_number: Contact's phone number (used as correlation key)
        data: Additional data for the job
        delay_seconds: Delay before processing
        job_id: Optional custom job ID

    Returns:
        Job ID
    """
    pool = await create_pool(get_redis_settings())

    try:
        job = await pool.enqueue_job(
            job_type.value,
            phone_number=phone_number,
            data=data or {},
            _job_id=job_id,
            _defer_by=delay_seconds if delay_seconds > 0 else None,
        )
        return job.job_id
    finally:
        await pool.close()


async def enqueue_research(
    phone_number: str,
    email: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    company_name: Optional[str] = None,
) -> str:
    """Convenience function to enqueue research job"""
    return await enqueue_job(
        JobType.RESEARCH_CONTACT,
        phone_number,
        data={
            "email": email,
            "linkedin_url": linkedin_url,
            "first_name": first_name,
            "last_name": last_name,
            "company_name": company_name,
        },
    )


async def enqueue_qualification(
    phone_number: str,
    contact_data: dict,
    research_data: Optional[dict] = None,
) -> str:
    """Convenience function to enqueue qualification job"""
    return await enqueue_job(
        JobType.QUALIFY_LEAD,
        phone_number,
        data={
            "contact_data": contact_data,
            "research_data": research_data,
        },
    )


async def enqueue_video(
    phone_number: str,
    script: str,
) -> str:
    """Convenience function to enqueue video generation job"""
    return await enqueue_job(
        JobType.GENERATE_VIDEO,
        phone_number,
        data={"script": script},
    )


async def enqueue_voice(
    phone_number: str,
    script: str,
) -> str:
    """Convenience function to enqueue voice generation job"""
    return await enqueue_job(
        JobType.GENERATE_VOICE,
        phone_number,
        data={"script": script},
    )


async def enqueue_crm_sync(
    phone_number: str,
    contact_data: dict,
    create_deal: bool = False,
    note: Optional[str] = None,
) -> str:
    """Convenience function to enqueue CRM sync job"""
    return await enqueue_job(
        JobType.SYNC_CRM,
        phone_number,
        data={
            "contact_data": contact_data,
            "create_deal": create_deal,
            "note": note,
        },
    )


async def enqueue_send_message(
    phone_number: str,
    message_type: str,
    content: str,
    media_url: Optional[str] = None,
    delay_seconds: int = 0,
) -> str:
    """Convenience function to enqueue outbound message"""
    return await enqueue_job(
        JobType.SEND_MESSAGE,
        phone_number,
        data={
            "message_type": message_type,
            "content": content,
            "media_url": media_url,
        },
        delay_seconds=delay_seconds,
    )


async def enqueue_process_incoming(
    phone_number: str,
    message_id: str,
    message_type: str,
    content: str,
    push_name: Optional[str] = None,
    media_id: Optional[str] = None,
) -> str:
    """Convenience function to enqueue incoming message processing"""
    return await enqueue_job(
        JobType.PROCESS_INCOMING,
        phone_number,
        data={
            "message_id": message_id,
            "message_type": message_type,
            "content": content,
            "push_name": push_name,
            "media_id": media_id,
        },
    )
