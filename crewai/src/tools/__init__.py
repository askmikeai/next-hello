"""
NextHello CrewAI Tools

Custom tools for integrating with external services:
- People Data Labs (PDL) for contact enrichment
- HeyGen for video generation
- ElevenLabs for voice synthesis
- HubSpot for CRM operations
"""

from .pdl_tools import pdl_enrich_contact, pdl_search_company
from .heygen_tools import heygen_generate_video, heygen_check_status
from .elevenlabs_tools import elevenlabs_generate_voice, elevenlabs_list_voices
from .hubspot_tools import hubspot_sync_contact, hubspot_create_deal, hubspot_add_note
from .supabase_tools import (
    get_contact_by_phone,
    update_contact,
    save_research_data,
    save_qualification,
)

__all__ = [
    # PDL
    "pdl_enrich_contact",
    "pdl_search_company",
    # HeyGen
    "heygen_generate_video",
    "heygen_check_status",
    # ElevenLabs
    "elevenlabs_generate_voice",
    "elevenlabs_list_voices",
    # HubSpot
    "hubspot_sync_contact",
    "hubspot_create_deal",
    "hubspot_add_note",
    # Supabase
    "get_contact_by_phone",
    "update_contact",
    "save_research_data",
    "save_qualification",
]
