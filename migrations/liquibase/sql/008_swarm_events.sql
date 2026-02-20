-- Swarm Event Architecture Tables
-- Supports true swarm architecture with autonomous agents

-- Event Log - Tracks all events for debugging and auditing
CREATE TABLE IF NOT EXISTS swarm_event_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source_agent TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    causation_id TEXT,
    correlation_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for event log
CREATE INDEX IF NOT EXISTS idx_swarm_events_contact ON swarm_event_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_swarm_events_type ON swarm_event_log(event_type);
CREATE INDEX IF NOT EXISTS idx_swarm_events_correlation ON swarm_event_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_swarm_events_created ON swarm_event_log(created_at DESC);

-- Agent State - Tracks agent processing state per contact
CREATE TABLE IF NOT EXISTS swarm_agent_state (
    agent_name TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    state TEXT NOT NULL,
    current_event_id TEXT,
    last_action_at TIMESTAMPTZ,
    PRIMARY KEY (agent_name, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_swarm_agent_state_agent ON swarm_agent_state(agent_name);

-- Add swarm-specific columns to networking_contacts
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS pending_actions JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS voice_mode BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS welcomed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS research_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS research_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS qualification_updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS crm_synced_at TIMESTAMPTZ;

-- Index for finding contacts by research status
CREATE INDEX IF NOT EXISTS idx_contacts_research_status ON networking_contacts(research_status);

-- Index for finding contacts by qualification tier
CREATE INDEX IF NOT EXISTS idx_contacts_qualification_tier ON networking_contacts(qualification_tier);
