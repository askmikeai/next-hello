"""OpenClaw tools for deterministic contact research."""

import json
from typing import Optional

from crewai.tools import tool

from ..swarm.openclaw_client import extract_output_text, post_openclaw_responses_sync


@tool("OpenClaw Research Contact")
def openclaw_research_contact(
    full_name: str,
    company: Optional[str] = None,
    linkedin_url: Optional[str] = None,
) -> str:
    """
    Run deterministic OpenClaw research for a person.

    Args:
        full_name: Person full name to research.
        company: Optional company constraint.
        linkedin_url: Optional LinkedIn URL hint.

    Returns minified JSON with normalized fields or an error object.
    """
    prompt = (
        "You are a deterministic research operator. Return only minified JSON with this schema: "
        '{"full_name":string|null,"first_name":string|null,"last_name":string|null,'
        '"job_title":string|null,"company_name":string|null,"company_industry":string|null,'
        '"company_size":string|null,"linkedin_url":string|null,"work_email":string|null,'
        '"location":string|null,"skills":string[],"experience_years":number|null,'
        '"education":array,"work_history":array,"source":string}. '
        f"Person: {full_name}. "
        f"Company filter: {company or ''}. "
        f"LinkedIn hint: {linkedin_url or ''}."
    )

    try:
        body = post_openclaw_responses_sync(
            model="openclaw:main",
            input_text=prompt,
        )
        output_text = extract_output_text(body)
        if not output_text:
            return json.dumps(
                {"ok": False, "error": "empty_openclaw_output"}, separators=(",", ":")
            )

        parsed = json.loads(output_text)
        if not isinstance(parsed, dict):
            return json.dumps(
                {"ok": False, "error": "invalid_openclaw_json"}, separators=(",", ":")
            )

        parsed.setdefault("source", "openclaw")
        return json.dumps(parsed, separators=(",", ":"))
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "error": "openclaw_research_failed",
                "details": str(exc),
            },
            separators=(",", ":"),
        )
