"""
People Data Labs (PDL) Tools for Contact Enrichment
"""

import os
from typing import Optional

import httpx
from crewai.tools import tool
from pydantic import BaseModel, Field


class PersonEnrichmentResult(BaseModel):
    """Result from PDL person enrichment"""

    full_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    company_industry: Optional[str] = None
    company_size: Optional[str] = None
    linkedin_url: Optional[str] = None
    work_email: Optional[str] = None
    location: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    experience_years: Optional[int] = None
    education: list[dict] = Field(default_factory=list)
    work_history: list[dict] = Field(default_factory=list)
    success: bool = False
    error: Optional[str] = None


@tool("PDL Enrich Contact")
def pdl_enrich_contact(
    email: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    company: Optional[str] = None,
) -> str:
    """
    Enrich a contact's profile using People Data Labs API.

    Provide at least one of:
    - email: Contact's email address
    - linkedin_url: Contact's LinkedIn profile URL
    - first_name + last_name + company: Name and company combination

    Returns enriched profile data including job title, company info,
    skills, education, and work history.
    """
    api_key = os.getenv("PDL_API_KEY")
    if not api_key:
        return "Error: PDL_API_KEY environment variable not set"

    # Build query parameters
    params = {"api_key": api_key, "pretty": "true"}

    if email:
        params["email"] = email
    if linkedin_url:
        params["profile"] = linkedin_url
    if first_name:
        params["first_name"] = first_name
    if last_name:
        params["last_name"] = last_name
    if company:
        params["company"] = company

    # Need at least one identifier
    if not any([email, linkedin_url, (first_name and company)]):
        return "Error: Provide email, LinkedIn URL, or name+company"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                "https://api.peopledatalabs.com/v5/person/enrich",
                params=params,
            )

            if response.status_code == 404:
                return "No matching profile found in People Data Labs"

            if response.status_code != 200:
                return f"PDL API error: {response.status_code} - {response.text}"

            data = response.json()

            # Extract relevant fields
            result = PersonEnrichmentResult(
                success=True,
                full_name=data.get("full_name"),
                first_name=data.get("first_name"),
                last_name=data.get("last_name"),
                job_title=data.get("job_title"),
                linkedin_url=data.get("linkedin_url"),
                work_email=data.get("work_email"),
                location=_format_location(data),
                skills=data.get("skills", [])[:10],  # Top 10 skills
                experience_years=_calculate_experience(data),
            )

            # Extract company info
            if data.get("job_company_name"):
                result.company_name = data.get("job_company_name")
                result.company_industry = data.get("job_company_industry")
                result.company_size = data.get("job_company_size")

            # Extract education (most recent)
            education = data.get("education", [])
            if education:
                result.education = [
                    {
                        "school": edu.get("school", {}).get("name"),
                        "degree": edu.get("degrees", [None])[0],
                        "field": edu.get("majors", [None])[0],
                    }
                    for edu in education[:3]
                ]

            # Extract work history (last 3 jobs)
            experience = data.get("experience", [])
            if experience:
                result.work_history = [
                    {
                        "title": exp.get("title", {}).get("name"),
                        "company": exp.get("company", {}).get("name"),
                        "start_date": exp.get("start_date"),
                        "end_date": exp.get("end_date"),
                    }
                    for exp in experience[:3]
                ]

            return result.model_dump_json(indent=2)

    except httpx.TimeoutException:
        return "Error: PDL API request timed out"
    except Exception as e:
        return f"Error enriching contact: {str(e)}"


@tool("PDL Search Company")
def pdl_search_company(company_name: str) -> str:
    """
    Search for company information using People Data Labs.

    Args:
        company_name: Name of the company to search

    Returns company details including industry, size, location, and description.
    """
    api_key = os.getenv("PDL_API_KEY")
    if not api_key:
        return "Error: PDL_API_KEY environment variable not set"

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                "https://api.peopledatalabs.com/v5/company/enrich",
                params={
                    "api_key": api_key,
                    "name": company_name,
                    "pretty": "true",
                },
            )

            if response.status_code == 404:
                return f"No company found matching '{company_name}'"

            if response.status_code != 200:
                return f"PDL API error: {response.status_code}"

            data = response.json()

            return f"""
Company: {data.get('name', company_name)}
Industry: {data.get('industry', 'Unknown')}
Size: {data.get('size', 'Unknown')} employees
Location: {data.get('location', {}).get('name', 'Unknown')}
Website: {data.get('website', 'Unknown')}
LinkedIn: {data.get('linkedin_url', 'Unknown')}
Description: {data.get('summary', 'No description available')[:500]}
Founded: {data.get('founded', 'Unknown')}
"""

    except Exception as e:
        return f"Error searching company: {str(e)}"


def _format_location(data: dict) -> Optional[str]:
    """Format location from PDL data"""
    parts = []
    if data.get("location_locality"):
        parts.append(data["location_locality"])
    if data.get("location_region"):
        parts.append(data["location_region"])
    if data.get("location_country"):
        parts.append(data["location_country"])
    return ", ".join(parts) if parts else None


def _calculate_experience(data: dict) -> Optional[int]:
    """Calculate years of experience from work history"""
    experience = data.get("experience", [])
    if not experience:
        return None

    # Find earliest start date
    earliest_year = None
    for exp in experience:
        start = exp.get("start_date")
        if start:
            try:
                year = int(start.split("-")[0])
                if earliest_year is None or year < earliest_year:
                    earliest_year = year
            except (ValueError, IndexError):
                continue

    if earliest_year:
        from datetime import datetime

        return datetime.now().year - earliest_year

    return None
