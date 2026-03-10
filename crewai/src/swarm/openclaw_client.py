import os
from typing import Any, Optional

import httpx


def _normalized_base_url() -> str:
    return os.getenv("OPENCLAW_BASE_URL", "").strip().rstrip("/")


def _candidate_base_urls() -> list[str]:
    base_url = _normalized_base_url()
    if not base_url:
        return []

    candidates = [base_url]
    host_fallback = "http://host.docker.internal:18789"
    if base_url != host_fallback:
        candidates.append(host_fallback)
    return candidates


def extract_output_text(body: dict[str, Any]) -> str:
    """Extract assistant text from OpenClaw /v1/responses payload."""
    if not isinstance(body, dict):
        return ""

    output = body.get("output")
    if not isinstance(output, list):
        return ""

    text_parts: list[str] = []
    for item in output:
        if not isinstance(item, dict):
            continue

        content = item.get("content")
        if not isinstance(content, list):
            continue

        for content_item in content:
            if not isinstance(content_item, dict):
                continue
            text = content_item.get("text")
            if isinstance(text, str) and text.strip():
                text_parts.append(text)

    return "\n".join(text_parts).strip()


async def post_openclaw_responses(
    *,
    model: str,
    input_text: str,
    timeout_seconds: Optional[float] = None,
) -> dict[str, Any]:
    token = os.getenv("OPENCLAW_GATEWAY_TOKEN", "").strip()
    if not token:
        raise ValueError("OPENCLAW_GATEWAY_TOKEN is required")

    timeout = timeout_seconds or float(os.getenv("OPENCLAW_TIMEOUT_SECONDS", "120"))
    payload = {
        "model": model,
        "input": input_text,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    last_error: Exception | None = None
    for base_url in _candidate_base_urls():
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{base_url}/v1/responses",
                    json=payload,
                    headers=headers,
                )
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: PERF203
            last_error = exc

    raise RuntimeError(f"OpenClaw /v1/responses request failed: {last_error}")


def post_openclaw_responses_sync(
    *,
    model: str,
    input_text: str,
    timeout_seconds: Optional[float] = None,
) -> dict[str, Any]:
    token = os.getenv("OPENCLAW_GATEWAY_TOKEN", "").strip()
    if not token:
        raise ValueError("OPENCLAW_GATEWAY_TOKEN is required")

    timeout = timeout_seconds or float(os.getenv("OPENCLAW_TIMEOUT_SECONDS", "120"))
    payload = {
        "model": model,
        "input": input_text,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    last_error: Exception | None = None
    for base_url in _candidate_base_urls():
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(
                    f"{base_url}/v1/responses",
                    json=payload,
                    headers=headers,
                )
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: PERF203
            last_error = exc

    raise RuntimeError(f"OpenClaw /v1/responses request failed: {last_error}")


async def post_openclaw_hook_agent(
    *,
    message: str,
    name: str = "docker-job",
    deliver: bool = False,
    wake_mode: str = "next-heartbeat",
    timeout_seconds: Optional[float] = None,
) -> dict[str, Any]:
    token = os.getenv("OPENCLAW_HOOKS_TOKEN", "").strip()
    if not token:
        raise ValueError("OPENCLAW_HOOKS_TOKEN is required")

    timeout = timeout_seconds or float(os.getenv("OPENCLAW_TIMEOUT_SECONDS", "120"))
    payload = {
        "message": message,
        "name": name,
        "deliver": deliver,
        "wakeMode": wake_mode,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    last_error: Exception | None = None
    for base_url in _candidate_base_urls():
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{base_url}/hooks/agent",
                    json=payload,
                    headers=headers,
                )
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: PERF203
            last_error = exc

    raise RuntimeError(f"OpenClaw /hooks/agent request failed: {last_error}")
