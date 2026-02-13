-- Base Contacts Table
-- Creates the networking_contacts table if it doesn't exist
-- This is the foundation table for the swarm architecture

-- ============================================================================
-- Networking Contacts Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS networking_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT UNIQUE NOT NULL,

    -- Profile
    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    email TEXT,
    company_name TEXT,
    job_title TEXT,
    website TEXT,
    linkedin_url TEXT,
    twitter_handle TEXT,

    -- Event context
    event_met_at TEXT,
    event_name TEXT,
    date_met DATE,

    -- Relationship details
    mutual_connection TEXT,
    how_i_can_help TEXT,
    what_theyre_working_on TEXT,
    their_ask_or_need TEXT,

    -- Organization
    tags TEXT[],
    notes TEXT,
    industry TEXT,

    -- Follow-up tracking
    last_contact_date DATE,
    next_followup_date DATE,
    last_message_at TIMESTAMPTZ,

    -- Workflow status
    status TEXT DEFAULT 'new' CHECK (status IN (
        'active', 'inactive', 'archived',
        'new', 'welcomed', 'collecting', 'fields_complete',
        'synced', 'meeting_scheduled', 'complete'
    )),

    -- HeyGen video
    heygen_video_id TEXT,
    heygen_video_url TEXT,

    -- Calendly
    calendly_event_uri TEXT,
    calendly_scheduled_at TIMESTAMPTZ,

    -- CRM
    crm_contact_id TEXT,
    crm_synced_at TIMESTAMPTZ,

    -- Messaging
    channel TEXT,
    sent_personalized_message BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON networking_contacts(phone_number);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON networking_contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON networking_contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_created ON networking_contacts(created_at DESC);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_networking_contacts_updated_at ON networking_contacts;
CREATE TRIGGER update_networking_contacts_updated_at
    BEFORE UPDATE ON networking_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comment
COMMENT ON TABLE networking_contacts IS 'Contacts from networking events tracked by NextHello';
