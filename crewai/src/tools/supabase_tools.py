"""
Supabase Tools for Contact Database Operations
"""

import json
import os
from typing import Any, Optional

import httpx
from crewai.tools import tool


def _get_supabase_client() -> tuple[str, dict]:
    """Get Supabase URL and headers"""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY")

    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    return url, headers


@tool("Get Contact By Phone")
def get_contact_by_phone(phone_number: str) -> str:
    """
    Retrieve a contact's full record from the database by phone number.

    Args:
        phone_number: The contact's phone number (with country code)

    Returns the contact's full profile including research data and qualification.
    """
    try:
        url, headers = _get_supabase_client()

        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{url}/rest/v1/networking_contacts",
                headers=headers,
                params={
                    "phone_number": f"eq.{phone_number}",
                    "select": "*",
                },
            )

            if response.status_code != 200:
                return f"Database error: {response.status_code} - {response.text}"

            data = response.json()

            if not data:
                return f"No contact found with phone number: {phone_number}"

            contact = data[0]

            # Format the response
            result = f"""
Contact Found:
- Phone: {contact.get('phone_number')}
- Name: {contact.get('first_name', '')} {contact.get('last_name', '')}
- Email: {contact.get('email', 'Not provided')}
- Company: {contact.get('company_name', 'Not provided')}
- Title: {contact.get('job_title', 'Not provided')}
- LinkedIn: {contact.get('linkedin_url', 'Not provided')}
- Status: {contact.get('status', 'Unknown')}

Qualification:
- Score: {contact.get('qualification_score', 'Not scored')}
- Tier: {contact.get('qualification_tier', 'Not tiered')}

CRM:
- Contact ID: {contact.get('crm_contact_id', 'Not synced')}
- Synced At: {contact.get('crm_synced_at', 'Never')}

Video:
- Video ID: {contact.get('heygen_video_id', 'None')}
- Video URL: {contact.get('heygen_video_url', 'None')}
"""

            if contact.get('research_data'):
                result += f"\nResearch Data Available: Yes"

            return result

    except ValueError as e:
        return f"Configuration error: {str(e)}"
    except Exception as e:
        return f"Error retrieving contact: {str(e)}"


@tool("Update Contact")
def update_contact(
    phone_number: str,
    email: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    company_name: Optional[str] = None,
    job_title: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    status: Optional[str] = None,
) -> str:
    """
    Update a contact's information in the database.

    Args:
        phone_number: Contact's phone number (required for lookup)
        email: New email address
        first_name: New first name
        last_name: New last name
        company_name: New company name
        job_title: New job title
        linkedin_url: New LinkedIn URL
        status: New status (new, collecting, fields_complete, synced)

    Returns confirmation of the update.
    """
    try:
        url, headers = _get_supabase_client()

        # Build update payload
        updates: dict[str, Any] = {}
        if email:
            updates["email"] = email
        if first_name:
            updates["first_name"] = first_name
        if last_name:
            updates["last_name"] = last_name
        if company_name:
            updates["company_name"] = company_name
        if job_title:
            updates["job_title"] = job_title
        if linkedin_url:
            updates["linkedin_url"] = linkedin_url
        if status:
            updates["status"] = status

        if not updates:
            return "No fields to update provided"

        updates["updated_at"] = "now()"

        with httpx.Client(timeout=30.0) as client:
            response = client.patch(
                f"{url}/rest/v1/networking_contacts",
                headers=headers,
                params={"phone_number": f"eq.{phone_number}"},
                json=updates,
            )

            if response.status_code not in [200, 201, 204]:
                return f"Database error: {response.status_code} - {response.text}"

            data = response.json()

            if not data:
                return f"No contact found with phone number: {phone_number}"

            return f"""
Contact updated successfully!
- Phone: {phone_number}
- Updated fields: {', '.join(updates.keys())}
"""

    except ValueError as e:
        return f"Configuration error: {str(e)}"
    except Exception as e:
        return f"Error updating contact: {str(e)}"


@tool("Save Research Data")
def save_research_data(
    phone_number: str,
    research_data: dict,
) -> str:
    """
    Save enriched research data to a contact's record.

    Args:
        phone_number: Contact's phone number
        research_data: Dictionary containing enriched profile data from PDL

    Returns confirmation of the save.
    """
    try:
        url, headers = _get_supabase_client()

        with httpx.Client(timeout=30.0) as client:
            response = client.patch(
                f"{url}/rest/v1/networking_contacts",
                headers=headers,
                params={"phone_number": f"eq.{phone_number}"},
                json={
                    "research_data": research_data,
                    "updated_at": "now()",
                },
            )

            if response.status_code not in [200, 201, 204]:
                return f"Database error: {response.status_code} - {response.text}"

            data = response.json()

            if not data:
                return f"No contact found with phone number: {phone_number}"

            return f"""
Research data saved successfully!
- Phone: {phone_number}
- Data fields: {len(research_data)} fields saved
"""

    except ValueError as e:
        return f"Configuration error: {str(e)}"
    except Exception as e:
        return f"Error saving research data: {str(e)}"


@tool("Save Qualification")
def save_qualification(
    phone_number: str,
    score: int,
    tier: str,
    factors: Optional[dict] = None,
    notes: Optional[str] = None,
) -> str:
    """
    Save qualification score and tier to a contact's record.

    Args:
        phone_number: Contact's phone number
        score: Qualification score (0-100)
        tier: Qualification tier (hot/warm/cold/unqualified)
        factors: Optional breakdown of scoring factors
        notes: Optional qualification notes

    Returns confirmation of the save.
    """
    if tier not in ["hot", "warm", "cold", "unqualified"]:
        return f"Invalid tier: {tier}. Must be hot, warm, cold, or unqualified"

    if not 0 <= score <= 100:
        return f"Invalid score: {score}. Must be between 0 and 100"

    try:
        url, headers = _get_supabase_client()

        update_data: dict[str, Any] = {
            "qualification_score": score,
            "qualification_tier": tier,
            "updated_at": "now()",
        }

        # Store factors and notes in swarm_metadata
        if factors or notes:
            metadata = {
                "qualificationFactors": factors,
                "qualificationNotes": notes,
                "qualifiedAt": __import__("datetime").datetime.now().isoformat(),
            }
            update_data["swarm_metadata"] = metadata

        with httpx.Client(timeout=30.0) as client:
            response = client.patch(
                f"{url}/rest/v1/networking_contacts",
                headers=headers,
                params={"phone_number": f"eq.{phone_number}"},
                json=update_data,
            )

            if response.status_code not in [200, 201, 204]:
                return f"Database error: {response.status_code} - {response.text}"

            data = response.json()

            if not data:
                return f"No contact found with phone number: {phone_number}"

            return f"""
Qualification saved successfully!
- Phone: {phone_number}
- Score: {score}/100
- Tier: {tier.upper()}
- Priority: {'High - immediate follow-up' if tier == 'hot' else 'Normal' if tier == 'warm' else 'Low'}
"""

    except ValueError as e:
        return f"Configuration error: {str(e)}"
    except Exception as e:
        return f"Error saving qualification: {str(e)}"
