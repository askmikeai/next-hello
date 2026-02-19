"""
ElevenLabs Tools for Voice Message Generation
"""

import os
import uuid
from pathlib import Path
from typing import Optional

import httpx
from crewai.tools import tool


@tool("ElevenLabs Generate Voice")
def elevenlabs_generate_voice(
    text: str,
    phone_number: str,
    output_dir: Optional[str] = None,
) -> str:
    """
    Generate a voice message using ElevenLabs text-to-speech.

    Args:
        text: The text to convert to speech (15-45 seconds recommended)
        phone_number: Contact's phone number for tracking
        output_dir: Directory to save audio file (default: /tmp/voice)

    Returns the path to the generated audio file.
    """
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        return "Error: ELEVENLABS_API_KEY environment variable not set"

    voice_id = os.getenv("ELEVENLABS_VOICE_ID")
    if not voice_id:
        return "Error: ELEVENLABS_VOICE_ID environment variable not set"

    # Estimate duration (150 words per minute)
    word_count = len(text.split())
    estimated_seconds = (word_count / 150) * 60

    if estimated_seconds > 60:
        return f"Warning: Text is {word_count} words (~{estimated_seconds:.0f}s). Consider shortening to under 150 words for 60 seconds max."

    # Setup output directory
    if output_dir is None:
        output_dir = "/tmp/voice"
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Generate unique filename
    filename = f"voice_{phone_number.replace('+', '')}_{uuid.uuid4().hex[:8]}.mp3"
    file_path = output_path / filename

    try:
        with httpx.Client(timeout=60.0) as client:
            response = client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={
                    "Accept": "audio/mpeg",
                    "Content-Type": "application/json",
                    "xi-api-key": api_key,
                },
                json={
                    "text": text,
                    "model_id": "eleven_monolingual_v1",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75,
                    },
                },
            )

            if response.status_code != 200:
                return f"ElevenLabs API error: {response.status_code} - {response.text}"

            # Save audio file
            with open(file_path, "wb") as f:
                f.write(response.content)

            file_size = file_path.stat().st_size

            return f"""
Voice message generated successfully!
- File: {file_path}
- Size: {file_size / 1024:.1f} KB
- Estimated duration: {estimated_seconds:.0f} seconds
- Word count: {word_count}
- Phone: {phone_number}

Ready for delivery via WhatsApp.
"""

    except httpx.TimeoutException:
        return "Error: ElevenLabs API request timed out"
    except Exception as e:
        return f"Error generating voice: {str(e)}"


@tool("ElevenLabs List Voices")
def elevenlabs_list_voices() -> str:
    """
    List available voices from ElevenLabs.

    Returns a list of available voices with their IDs and characteristics.
    """
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        return "Error: ELEVENLABS_API_KEY environment variable not set"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": api_key},
            )

            if response.status_code != 200:
                return f"ElevenLabs API error: {response.status_code}"

            data = response.json()
            voices = data.get("voices", [])

            if not voices:
                return "No voices available"

            result = "Available ElevenLabs Voices:\n\n"
            for voice in voices[:20]:  # Limit to 20 voices
                result += f"""
- {voice.get('name', 'Unknown')}
  ID: {voice.get('voice_id')}
  Category: {voice.get('category', 'Unknown')}
  Labels: {', '.join(voice.get('labels', {}).values()) or 'None'}
"""

            return result

    except Exception as e:
        return f"Error listing voices: {str(e)}"
