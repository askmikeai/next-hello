"""
HeyGen Tools for Video Generation
"""

import os
from typing import Optional

import httpx
from crewai.tools import tool


@tool("HeyGen Generate Video")
def heygen_generate_video(
    script: str,
    phone_number: str,
    webhook_url: Optional[str] = None,
) -> str:
    """
    Generate a personalized video using HeyGen's AI avatar.

    Args:
        script: The text script for the avatar to speak
        phone_number: Contact's phone number (used as callback_id)
        webhook_url: Optional webhook URL for completion notification

    Returns video_id for tracking the generation status.
    """
    api_key = os.getenv("HEYGEN_API_KEY")
    if not api_key:
        return "Error: HEYGEN_API_KEY environment variable not set"

    avatar_id = os.getenv("HEYGEN_AVATAR_ID")
    voice_id = os.getenv("HEYGEN_VOICE_ID")

    if not avatar_id or not voice_id:
        return "Error: HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID must be set"

    # Use webhook URL from env if not provided
    if not webhook_url:
        base_url = os.getenv("WEBHOOK_BASE_URL")
        if base_url:
            webhook_url = f"{base_url}/webhooks/networking-event/heygen"

    request_body = {
        "video_inputs": [
            {
                "character": {
                    "type": "avatar",
                    "avatar_id": avatar_id,
                    "avatar_style": "normal",
                },
                "voice": {
                    "type": "text",
                    "voice_id": voice_id,
                    "input_text": script,
                },
            }
        ],
        "dimension": {"width": 1280, "height": 720},
        "callback_id": phone_number,
    }

    if webhook_url:
        request_body["callback_url"] = webhook_url

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                "https://api.heygen.com/v2/video/generate",
                headers={
                    "Content-Type": "application/json",
                    "X-Api-Key": api_key,
                },
                json=request_body,
            )

            if response.status_code != 200:
                return f"HeyGen API error: {response.status_code} - {response.text}"

            data = response.json()

            if data.get("error"):
                return f"HeyGen error: {data['error']}"

            video_id = data.get("data", {}).get("video_id")

            if not video_id:
                return "Error: No video_id returned from HeyGen"

            return f"""
Video generation started successfully!
- Video ID: {video_id}
- Status: processing
- Phone: {phone_number}
- Webhook configured: {'Yes' if webhook_url else 'No'}

The video will be automatically sent when ready if webhook is configured.
Use heygen_check_status with video_id to manually check status.
"""

    except httpx.TimeoutException:
        return "Error: HeyGen API request timed out"
    except Exception as e:
        return f"Error generating video: {str(e)}"


@tool("HeyGen Check Status")
def heygen_check_status(video_id: str) -> str:
    """
    Check the status of a HeyGen video generation.

    Args:
        video_id: The video ID returned from heygen_generate_video

    Returns the current status and video URL if completed.
    """
    api_key = os.getenv("HEYGEN_API_KEY")
    if not api_key:
        return "Error: HEYGEN_API_KEY environment variable not set"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"https://api.heygen.com/v1/video_status.get?video_id={video_id}",
                headers={"X-Api-Key": api_key},
            )

            if response.status_code != 200:
                return f"HeyGen API error: {response.status_code}"

            data = response.json()

            if data.get("error"):
                return f"HeyGen error: {data['error']}"

            status_data = data.get("data", {})
            status = status_data.get("status", "unknown")
            video_url = status_data.get("video_url")

            result = f"""
Video Status:
- Video ID: {video_id}
- Status: {status}
"""

            if status == "completed" and video_url:
                result += f"- Video URL: {video_url}\n"
                result += "\nVideo is ready for delivery!"
            elif status == "processing":
                result += "\nVideo is still being generated. Check again in 1-2 minutes."
            elif status == "failed":
                error = status_data.get("error", "Unknown error")
                result += f"- Error: {error}\n"

            return result

    except Exception as e:
        return f"Error checking video status: {str(e)}"
