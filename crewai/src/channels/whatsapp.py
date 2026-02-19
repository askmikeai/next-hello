"""
WhatsApp Cloud API Integration

Handles incoming webhooks and outgoing messages via the official
WhatsApp Business Cloud API.
"""

import os
import hashlib
import hmac
import httpx
from typing import Optional, Any
from pydantic import BaseModel, Field
from enum import Enum


class MessageType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    DOCUMENT = "document"
    STICKER = "sticker"
    LOCATION = "location"
    CONTACTS = "contacts"
    INTERACTIVE = "interactive"
    BUTTON = "button"
    REACTION = "reaction"


class IncomingMessage(BaseModel):
    """Parsed incoming WhatsApp message"""

    message_id: str
    from_number: str
    timestamp: str
    message_type: MessageType
    text: Optional[str] = None
    media_id: Optional[str] = None
    media_url: Optional[str] = None
    media_mime_type: Optional[str] = None
    caption: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    contact_name: Optional[str] = None
    push_name: Optional[str] = None  # User's WhatsApp display name
    raw_payload: dict = Field(default_factory=dict)


class WhatsAppWebhook:
    """
    Handles WhatsApp Cloud API webhook verification and message parsing.
    """

    def __init__(self, verify_token: Optional[str] = None, app_secret: Optional[str] = None):
        self.verify_token = verify_token or os.getenv("WHATSAPP_VERIFY_TOKEN", "nexthello_verify")
        self.app_secret = app_secret or os.getenv("WHATSAPP_APP_SECRET")

    def verify_webhook(self, mode: str, token: str, challenge: str) -> Optional[str]:
        """
        Verify webhook subscription request from Meta.

        Args:
            mode: hub.mode parameter
            token: hub.verify_token parameter
            challenge: hub.challenge parameter

        Returns:
            The challenge string if verified, None otherwise
        """
        if mode == "subscribe" and token == self.verify_token:
            return challenge
        return None

    def verify_signature(self, payload: bytes, signature: str) -> bool:
        """
        Verify the X-Hub-Signature-256 header.

        Args:
            payload: Raw request body
            signature: X-Hub-Signature-256 header value

        Returns:
            True if signature is valid
        """
        if not self.app_secret:
            # Skip verification if no secret configured
            return True

        if not signature or not signature.startswith("sha256="):
            return False

        expected_signature = hmac.new(
            self.app_secret.encode(),
            payload,
            hashlib.sha256,
        ).hexdigest()

        return hmac.compare_digest(f"sha256={expected_signature}", signature)

    def parse_webhook(self, payload: dict) -> list[IncomingMessage]:
        """
        Parse incoming webhook payload into messages.

        Args:
            payload: The webhook JSON payload

        Returns:
            List of parsed messages
        """
        messages = []

        # Navigate the nested structure
        entries = payload.get("entry", [])
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                value = change.get("value", {})

                # Get contact info
                contacts = value.get("contacts", [])
                contact_map = {c["wa_id"]: c.get("profile", {}).get("name") for c in contacts}

                # Parse messages
                for msg in value.get("messages", []):
                    message = self._parse_message(msg, contact_map)
                    if message:
                        messages.append(message)

        return messages

    def _parse_message(self, msg: dict, contact_map: dict) -> Optional[IncomingMessage]:
        """Parse a single message from the webhook payload"""
        msg_type = msg.get("type")
        from_number = msg.get("from")

        if not msg_type or not from_number:
            return None

        base = {
            "message_id": msg.get("id"),
            "from_number": from_number,
            "timestamp": msg.get("timestamp"),
            "message_type": MessageType(msg_type) if msg_type in MessageType.__members__.values() else MessageType.TEXT,
            "push_name": contact_map.get(from_number),
            "raw_payload": msg,
        }

        if msg_type == "text":
            base["text"] = msg.get("text", {}).get("body")

        elif msg_type in ("image", "audio", "video", "document", "sticker"):
            media = msg.get(msg_type, {})
            base["media_id"] = media.get("id")
            base["media_mime_type"] = media.get("mime_type")
            base["caption"] = media.get("caption")

        elif msg_type == "location":
            location = msg.get("location", {})
            base["latitude"] = location.get("latitude")
            base["longitude"] = location.get("longitude")

        elif msg_type == "contacts":
            contacts = msg.get("contacts", [])
            if contacts:
                base["contact_name"] = contacts[0].get("name", {}).get("formatted_name")

        elif msg_type == "interactive":
            interactive = msg.get("interactive", {})
            reply_type = interactive.get("type")
            if reply_type == "button_reply":
                base["text"] = interactive.get("button_reply", {}).get("title")
            elif reply_type == "list_reply":
                base["text"] = interactive.get("list_reply", {}).get("title")

        elif msg_type == "button":
            base["text"] = msg.get("button", {}).get("text")

        return IncomingMessage(**base)


class WhatsAppClient:
    """
    Client for sending messages via WhatsApp Cloud API.
    """

    BASE_URL = "https://graph.facebook.com/v21.0"

    def __init__(
        self,
        phone_number_id: Optional[str] = None,
        access_token: Optional[str] = None,
    ):
        self.phone_number_id = phone_number_id or os.getenv("WHATSAPP_PHONE_NUMBER_ID")
        self.access_token = access_token or os.getenv("WHATSAPP_ACCESS_TOKEN")

        if not self.phone_number_id or not self.access_token:
            raise ValueError("WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN are required")

        self._client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    async def close(self):
        """Close the HTTP client"""
        await self._client.aclose()

    async def send_text(
        self,
        to: str,
        text: str,
        preview_url: bool = False,
    ) -> dict:
        """
        Send a text message.

        Args:
            to: Recipient phone number (with country code, no +)
            text: Message text
            preview_url: Whether to show URL previews

        Returns:
            API response
        """
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {
                "preview_url": preview_url,
                "body": text,
            },
        }
        return await self._send(payload)

    async def send_image(
        self,
        to: str,
        image_url: Optional[str] = None,
        image_id: Optional[str] = None,
        caption: Optional[str] = None,
    ) -> dict:
        """
        Send an image message.

        Args:
            to: Recipient phone number
            image_url: URL of the image (or use image_id)
            image_id: Media ID of uploaded image
            caption: Optional caption

        Returns:
            API response
        """
        image_data: dict[str, Any] = {}
        if image_id:
            image_data["id"] = image_id
        elif image_url:
            image_data["link"] = image_url
        else:
            raise ValueError("Either image_url or image_id is required")

        if caption:
            image_data["caption"] = caption

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "image",
            "image": image_data,
        }
        return await self._send(payload)

    async def send_audio(
        self,
        to: str,
        audio_url: Optional[str] = None,
        audio_id: Optional[str] = None,
    ) -> dict:
        """
        Send an audio message.

        Args:
            to: Recipient phone number
            audio_url: URL of the audio file
            audio_id: Media ID of uploaded audio

        Returns:
            API response
        """
        audio_data: dict[str, Any] = {}
        if audio_id:
            audio_data["id"] = audio_id
        elif audio_url:
            audio_data["link"] = audio_url
        else:
            raise ValueError("Either audio_url or audio_id is required")

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "audio",
            "audio": audio_data,
        }
        return await self._send(payload)

    async def send_video(
        self,
        to: str,
        video_url: Optional[str] = None,
        video_id: Optional[str] = None,
        caption: Optional[str] = None,
    ) -> dict:
        """
        Send a video message.

        Args:
            to: Recipient phone number
            video_url: URL of the video
            video_id: Media ID of uploaded video
            caption: Optional caption

        Returns:
            API response
        """
        video_data: dict[str, Any] = {}
        if video_id:
            video_data["id"] = video_id
        elif video_url:
            video_data["link"] = video_url
        else:
            raise ValueError("Either video_url or video_id is required")

        if caption:
            video_data["caption"] = caption

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "video",
            "video": video_data,
        }
        return await self._send(payload)

    async def send_document(
        self,
        to: str,
        document_url: Optional[str] = None,
        document_id: Optional[str] = None,
        filename: Optional[str] = None,
        caption: Optional[str] = None,
    ) -> dict:
        """
        Send a document.

        Args:
            to: Recipient phone number
            document_url: URL of the document
            document_id: Media ID of uploaded document
            filename: Filename to display
            caption: Optional caption

        Returns:
            API response
        """
        doc_data: dict[str, Any] = {}
        if document_id:
            doc_data["id"] = document_id
        elif document_url:
            doc_data["link"] = document_url
        else:
            raise ValueError("Either document_url or document_id is required")

        if filename:
            doc_data["filename"] = filename
        if caption:
            doc_data["caption"] = caption

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "document",
            "document": doc_data,
        }
        return await self._send(payload)

    async def send_reaction(
        self,
        to: str,
        message_id: str,
        emoji: str,
    ) -> dict:
        """
        Send a reaction to a message.

        Args:
            to: Recipient phone number
            message_id: ID of message to react to
            emoji: Emoji to react with

        Returns:
            API response
        """
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "reaction",
            "reaction": {
                "message_id": message_id,
                "emoji": emoji,
            },
        }
        return await self._send(payload)

    async def send_interactive_buttons(
        self,
        to: str,
        body_text: str,
        buttons: list[dict],
        header_text: Optional[str] = None,
        footer_text: Optional[str] = None,
    ) -> dict:
        """
        Send an interactive message with buttons.

        Args:
            to: Recipient phone number
            body_text: Main message body
            buttons: List of buttons [{"id": "btn1", "title": "Button 1"}, ...]
            header_text: Optional header
            footer_text: Optional footer

        Returns:
            API response
        """
        interactive: dict[str, Any] = {
            "type": "button",
            "body": {"text": body_text},
            "action": {
                "buttons": [
                    {"type": "reply", "reply": {"id": b["id"], "title": b["title"]}}
                    for b in buttons[:3]  # Max 3 buttons
                ]
            },
        }

        if header_text:
            interactive["header"] = {"type": "text", "text": header_text}
        if footer_text:
            interactive["footer"] = {"text": footer_text}

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive,
        }
        return await self._send(payload)

    async def send_interactive_list(
        self,
        to: str,
        body_text: str,
        button_text: str,
        sections: list[dict],
        header_text: Optional[str] = None,
        footer_text: Optional[str] = None,
    ) -> dict:
        """
        Send an interactive list message.

        Args:
            to: Recipient phone number
            body_text: Main message body
            button_text: Text on the list button
            sections: List sections with rows
            header_text: Optional header
            footer_text: Optional footer

        Returns:
            API response
        """
        interactive: dict[str, Any] = {
            "type": "list",
            "body": {"text": body_text},
            "action": {
                "button": button_text,
                "sections": sections,
            },
        }

        if header_text:
            interactive["header"] = {"type": "text", "text": header_text}
        if footer_text:
            interactive["footer"] = {"text": footer_text}

        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "interactive",
            "interactive": interactive,
        }
        return await self._send(payload)

    async def mark_as_read(self, message_id: str) -> dict:
        """
        Mark a message as read.

        Args:
            message_id: ID of message to mark as read

        Returns:
            API response
        """
        payload = {
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": message_id,
        }
        return await self._send(payload)

    async def download_media(self, media_id: str) -> tuple[bytes, str]:
        """
        Download media by ID.

        Args:
            media_id: The media ID

        Returns:
            Tuple of (content bytes, mime_type)
        """
        # First get the media URL
        response = await self._client.get(f"/{media_id}")
        response.raise_for_status()
        media_info = response.json()

        # Download the actual media
        media_url = media_info.get("url")
        mime_type = media_info.get("mime_type", "application/octet-stream")

        media_response = await self._client.get(media_url)
        media_response.raise_for_status()

        return media_response.content, mime_type

    async def upload_media(
        self,
        file_content: bytes,
        mime_type: str,
        filename: str,
    ) -> str:
        """
        Upload media to WhatsApp.

        Args:
            file_content: File content as bytes
            mime_type: MIME type of the file
            filename: Filename

        Returns:
            Media ID
        """
        files = {
            "file": (filename, file_content, mime_type),
            "messaging_product": (None, "whatsapp"),
            "type": (None, mime_type),
        }

        # Need to use multipart form data
        response = await self._client.post(
            f"/{self.phone_number_id}/media",
            files=files,
        )
        response.raise_for_status()
        return response.json().get("id")

    async def _send(self, payload: dict) -> dict:
        """Send a message payload to the API"""
        response = await self._client.post(
            f"/{self.phone_number_id}/messages",
            json=payload,
        )
        response.raise_for_status()
        return response.json()
