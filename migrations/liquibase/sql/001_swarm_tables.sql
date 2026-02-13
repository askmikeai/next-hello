-- Swarm Architecture Database Migration
-- Creates tables for message history, agent activity logging, and contact extensions

-- ============================================================================
-- Message History Table
-- Stores all conversation messages for context building
-- ============================================================================
CREATE TABLE IF NOT EXISTS message_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID REFERENCES networking_contacts(id) ON DELETE SET NULL,
    phone_number TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'email')),
    content TEXT NOT NULL,
    agent_id TEXT,
    model_used TEXT,
    tokens_used INTEGER,
    tool_calls JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_message_history_phone ON message_history(phone_number);
CREATE INDEX IF NOT EXISTS idx_message_history_contact ON message_history(contact_id);
CREATE INDEX IF NOT EXISTS idx_message_history_correlation ON message_history(correlation_id);
CREATE INDEX IF NOT EXISTS idx_message_history_created ON message_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_history_phone_created ON message_history(phone_number, created_at DESC);

-- ============================================================================
-- Agent Activity Log Table
-- Tracks agent executions for monitoring and debugging
-- ============================================================================
CREATE TABLE IF NOT EXISTS agent_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correlation_id TEXT NOT NULL,
    contact_id UUID REFERENCES networking_contacts(id) ON DELETE SET NULL,
    agent_type TEXT NOT NULL CHECK (agent_type IN (
        'orchestrator', 'conversation', 'research',
        'qualification', 'personalization', 'video', 'crm'
    )),
    action TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    status TEXT CHECK (status IN ('started', 'completed', 'failed')),
    input_tokens INTEGER,
    output_tokens INTEGER,
    error_message TEXT
);

-- Indexes for agent activity
CREATE INDEX IF NOT EXISTS idx_agent_activity_correlation ON agent_activity_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_contact ON agent_activity_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_type ON agent_activity_log(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_activity_started ON agent_activity_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_activity_status ON agent_activity_log(status);

-- ============================================================================
-- Contact Table Extensions
-- Add new columns for swarm-related data
-- ============================================================================

-- Qualification fields
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS qualification_score NUMERIC(5,2);

ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS qualification_tier TEXT
CHECK (qualification_tier IN ('hot', 'warm', 'cold', 'unqualified'));

-- Research fields
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS research_status TEXT
CHECK (research_status IN ('pending', 'in_progress', 'complete', 'failed'));

ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS research_data JSONB;

-- Swarm tracking
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS total_turns INTEGER DEFAULT 0;

ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS swarm_metadata JSONB;

-- Index for qualification queries
CREATE INDEX IF NOT EXISTS idx_contacts_qualification_tier
ON networking_contacts(qualification_tier);

CREATE INDEX IF NOT EXISTS idx_contacts_research_status
ON networking_contacts(research_status);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Function to clean up old messages (keep last N per phone)
CREATE OR REPLACE FUNCTION cleanup_old_messages(
    p_phone_number TEXT,
    p_keep_count INTEGER DEFAULT 100
) RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH messages_to_keep AS (
        SELECT id
        FROM message_history
        WHERE phone_number = p_phone_number
        ORDER BY created_at DESC
        LIMIT p_keep_count
    )
    DELETE FROM message_history
    WHERE phone_number = p_phone_number
    AND id NOT IN (SELECT id FROM messages_to_keep);

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get conversation summary
CREATE OR REPLACE FUNCTION get_conversation_summary(p_phone_number TEXT)
RETURNS TABLE (
    message_count BIGINT,
    first_message TIMESTAMPTZ,
    last_message TIMESTAMPTZ,
    inbound_count BIGINT,
    outbound_count BIGINT,
    total_tokens BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) as message_count,
        MIN(created_at) as first_message,
        MAX(created_at) as last_message,
        COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_count,
        COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_count,
        COALESCE(SUM(tokens_used), 0) as total_tokens
    FROM message_history
    WHERE phone_number = p_phone_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE message_history IS 'Stores conversation messages for AI context building';
COMMENT ON TABLE agent_activity_log IS 'Tracks swarm agent executions for monitoring';
COMMENT ON COLUMN networking_contacts.qualification_score IS 'Lead score from 0-100';
COMMENT ON COLUMN networking_contacts.qualification_tier IS 'Lead tier: hot, warm, cold, unqualified';
COMMENT ON COLUMN networking_contacts.research_status IS 'LinkedIn/company research status';
COMMENT ON COLUMN networking_contacts.research_data IS 'Enriched data from research agents';
COMMENT ON COLUMN networking_contacts.total_turns IS 'Total conversation turns with this contact';
COMMENT ON COLUMN networking_contacts.swarm_metadata IS 'Additional swarm-related metadata';
