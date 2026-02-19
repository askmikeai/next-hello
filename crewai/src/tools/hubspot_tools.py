"""
HubSpot CRM Tools for Contact Synchronization
"""

import os
from typing import Optional

import httpx
from crewai.tools import tool


@tool("HubSpot Sync Contact")
def hubspot_sync_contact(
    phone_number: str,
    email: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    company: Optional[str] = None,
    job_title: Optional[str] = None,
    linkedin_url: Optional[str] = None,
) -> str:
    """
    Create or update a contact in HubSpot CRM.

    Args:
        phone_number: Contact's phone number (required)
        email: Contact's email address
        first_name: Contact's first name
        last_name: Contact's last name
        company: Contact's company name
        job_title: Contact's job title
        linkedin_url: Contact's LinkedIn profile URL

    Returns the HubSpot contact ID.
    """
    api_key = os.getenv("HUBSPOT_API_KEY")
    if not api_key:
        return "Error: HUBSPOT_API_KEY environment variable not set"

    # Build properties
    properties = {"phone": phone_number}
    if email:
        properties["email"] = email
    if first_name:
        properties["firstname"] = first_name
    if last_name:
        properties["lastname"] = last_name
    if company:
        properties["company"] = company
    if job_title:
        properties["jobtitle"] = job_title
    if linkedin_url:
        properties["linkedin_profile"] = linkedin_url

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            # First, try to find existing contact by email or phone
            existing_id = None

            if email:
                search_response = client.post(
                    "https://api.hubapi.com/crm/v3/objects/contacts/search",
                    headers=headers,
                    json={
                        "filterGroups": [
                            {
                                "filters": [
                                    {
                                        "propertyName": "email",
                                        "operator": "EQ",
                                        "value": email,
                                    }
                                ]
                            }
                        ]
                    },
                )
                if search_response.status_code == 200:
                    results = search_response.json().get("results", [])
                    if results:
                        existing_id = results[0]["id"]

            if existing_id:
                # Update existing contact
                response = client.patch(
                    f"https://api.hubapi.com/crm/v3/objects/contacts/{existing_id}",
                    headers=headers,
                    json={"properties": properties},
                )
                action = "updated"
            else:
                # Create new contact
                response = client.post(
                    "https://api.hubapi.com/crm/v3/objects/contacts",
                    headers=headers,
                    json={"properties": properties},
                )
                action = "created"

            if response.status_code not in [200, 201]:
                return f"HubSpot API error: {response.status_code} - {response.text}"

            data = response.json()
            contact_id = data.get("id")

            return f"""
Contact {action} successfully in HubSpot!
- Contact ID: {contact_id}
- Phone: {phone_number}
- Email: {email or 'Not provided'}
- Name: {first_name or ''} {last_name or ''}

View in HubSpot: https://app.hubspot.com/contacts/{contact_id}
"""

    except Exception as e:
        return f"Error syncing contact: {str(e)}"


@tool("HubSpot Create Deal")
def hubspot_create_deal(
    contact_id: str,
    deal_name: str,
    pipeline: Optional[str] = None,
    stage: Optional[str] = None,
    amount: Optional[float] = None,
) -> str:
    """
    Create a deal/opportunity in HubSpot and associate it with a contact.

    Args:
        contact_id: HubSpot contact ID to associate
        deal_name: Name for the deal
        pipeline: Pipeline ID (default: default pipeline)
        stage: Deal stage (default: first stage)
        amount: Deal amount in dollars

    Returns the HubSpot deal ID.
    """
    api_key = os.getenv("HUBSPOT_API_KEY")
    if not api_key:
        return "Error: HUBSPOT_API_KEY environment variable not set"

    properties = {"dealname": deal_name}
    if pipeline:
        properties["pipeline"] = pipeline
    if stage:
        properties["dealstage"] = stage
    if amount:
        properties["amount"] = str(amount)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            # Create the deal
            response = client.post(
                "https://api.hubapi.com/crm/v3/objects/deals",
                headers=headers,
                json={"properties": properties},
            )

            if response.status_code not in [200, 201]:
                return f"HubSpot API error: {response.status_code} - {response.text}"

            data = response.json()
            deal_id = data.get("id")

            # Associate deal with contact
            assoc_response = client.put(
                f"https://api.hubapi.com/crm/v3/objects/deals/{deal_id}/associations/contacts/{contact_id}/deal_to_contact",
                headers=headers,
            )

            if assoc_response.status_code not in [200, 201, 204]:
                return f"Deal created (ID: {deal_id}) but association failed: {assoc_response.status_code}"

            return f"""
Deal created successfully in HubSpot!
- Deal ID: {deal_id}
- Deal Name: {deal_name}
- Associated Contact: {contact_id}

View in HubSpot: https://app.hubspot.com/deals/{deal_id}
"""

    except Exception as e:
        return f"Error creating deal: {str(e)}"


@tool("HubSpot Add Note")
def hubspot_add_note(
    contact_id: str,
    note_body: str,
) -> str:
    """
    Add a note to a HubSpot contact.

    Args:
        contact_id: HubSpot contact ID
        note_body: Content of the note

    Returns confirmation of note creation.
    """
    api_key = os.getenv("HUBSPOT_API_KEY")
    if not api_key:
        return "Error: HUBSPOT_API_KEY environment variable not set"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            # Create the note (engagement)
            response = client.post(
                "https://api.hubapi.com/crm/v3/objects/notes",
                headers=headers,
                json={
                    "properties": {
                        "hs_note_body": note_body,
                        "hs_timestamp": str(int(__import__("time").time() * 1000)),
                    }
                },
            )

            if response.status_code not in [200, 201]:
                return f"HubSpot API error: {response.status_code} - {response.text}"

            data = response.json()
            note_id = data.get("id")

            # Associate note with contact
            assoc_response = client.put(
                f"https://api.hubapi.com/crm/v3/objects/notes/{note_id}/associations/contacts/{contact_id}/note_to_contact",
                headers=headers,
            )

            if assoc_response.status_code not in [200, 201, 204]:
                return f"Note created (ID: {note_id}) but association failed"

            return f"""
Note added successfully to HubSpot contact!
- Note ID: {note_id}
- Contact ID: {contact_id}
- Content: {note_body[:100]}{'...' if len(note_body) > 100 else ''}
"""

    except Exception as e:
        return f"Error adding note: {str(e)}"
