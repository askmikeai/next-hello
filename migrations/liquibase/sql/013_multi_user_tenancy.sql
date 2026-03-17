-- Multi-user tenancy isolation
-- Adds owner_id across operational tables so users only see their own data.

ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE agent_activity_log
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE swarm_event_log
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE swarm_agent_state
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE media_files
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE pdl_person_enrichment
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE pdl_company_enrichment
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE whatsapp_sessions
ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE networking_contacts DROP CONSTRAINT IF EXISTS networking_contacts_phone_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_owner_phone_unique
ON networking_contacts(owner_id, phone_number);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_updated
ON networking_contacts(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_history_owner_phone_created
ON message_history(owner_id, phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_activity_owner_started
ON agent_activity_log(owner_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_event_owner_created
ON swarm_event_log(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_owner_phone
ON media_files(owner_id, phone_number)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pdl_person_owner_contact
ON pdl_person_enrichment(owner_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdl_company_owner_contact
ON pdl_company_enrichment(owner_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_owner_session
ON whatsapp_sessions(owner_id, session_id);

ALTER TABLE swarm_agent_state DROP CONSTRAINT IF EXISTS swarm_agent_state_pkey;

ALTER TABLE swarm_agent_state
ADD CONSTRAINT swarm_agent_state_pkey PRIMARY KEY (owner_id, agent_name, contact_id);
