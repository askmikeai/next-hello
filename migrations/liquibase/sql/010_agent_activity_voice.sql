-- Add 'voice' to agent_activity_log agent_type CHECK constraint
-- The voice_agent was missing from the original allowed values

ALTER TABLE agent_activity_log
DROP CONSTRAINT IF EXISTS agent_activity_log_agent_type_check;

ALTER TABLE agent_activity_log
ADD CONSTRAINT agent_activity_log_agent_type_check
CHECK (agent_type IN (
    'orchestrator', 'conversation', 'research',
    'qualification', 'personalization', 'video', 'voice', 'crm'
));
