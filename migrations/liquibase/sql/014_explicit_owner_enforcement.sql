-- Reassign legacy "default" tenant data to explicit owner and remove table defaults.

-- Canonical owner id for askmikeai@gmail.com after sanitization.
-- '@' is replaced with '-', yielding askmikeai-gmail.com.

UPDATE networking_contacts SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE message_history SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE agent_activity_log SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE swarm_event_log SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE swarm_agent_state SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE media_files SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE pdl_person_enrichment SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE pdl_company_enrichment SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';
UPDATE whatsapp_sessions SET owner_id = 'askmikeai-gmail.com' WHERE owner_id = 'default';

ALTER TABLE networking_contacts ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE message_history ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE agent_activity_log ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE swarm_event_log ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE swarm_agent_state ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE media_files ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE pdl_person_enrichment ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE pdl_company_enrichment ALTER COLUMN owner_id DROP DEFAULT;
ALTER TABLE whatsapp_sessions ALTER COLUMN owner_id DROP DEFAULT;
