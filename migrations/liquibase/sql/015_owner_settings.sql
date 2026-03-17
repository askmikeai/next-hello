-- Per-owner settings / config table.
-- Each owner gets one JSONB blob holding all their agent keys, identity, goals, and behavior prefs.

CREATE TABLE IF NOT EXISTS owner_settings (
    owner_id    TEXT PRIMARY KEY,
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_settings_updated ON owner_settings(updated_at);

-- Seed askmikeai-gmail.com with current production defaults from env vars.
INSERT INTO owner_settings (owner_id, config) VALUES (
    'askmikeai-gmail.com',
    '{
        "identity": {
            "owner_name": "Michael Friedberg",
            "owner_role": "AI Swarm Architect",
            "owner_location": "Miami",
            "owner_interests": "CrossFit, boating, traveling",
            "owner_favorite_place": "Florianopolis, Brazil",
            "event_name": "DeepStation OpenClaw Demo",
            "calendly_url": "https://calendly.com/askmikeai"
        },
        "llm": {
            "primary_provider": "anthropic/claude-sonnet-4-20250514",
            "openai_api_key": "",
            "anthropic_api_key": ""
        },
        "heygen": {
            "api_key": "",
            "avatar_id": "",
            "voice_id": ""
        },
        "elevenlabs": {
            "api_key": "",
            "voice_id": ""
        },
        "openclaw": {
            "enabled": true,
            "base_url": "",
            "gateway_token": "",
            "hooks_token": "",
            "research_url": "",
            "api_key": "",
            "timeout_seconds": 120
        },
        "crm": {
            "hubspot_api_key": ""
        },
        "research": {
            "pdl_api_key": ""
        },
        "behavior": {
            "moderation_mode": false,
            "demo_mode": false,
            "webhook_base_url": ""
        },
        "goals": {
            "primary_goal": "book-meetings",
            "preferred_tone": "warm-professional",
            "speed": "balanced",
            "success_metric": "",
            "notes": "",
            "autopilot_enabled": true
        }
    }'::jsonb
) ON CONFLICT (owner_id) DO NOTHING;
