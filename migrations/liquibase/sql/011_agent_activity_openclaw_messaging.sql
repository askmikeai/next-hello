-- Add 'openclaw' and 'messaging' to agent_activity_log agent_type CHECK constraint

ALTER TABLE agent_activity_log
DROP CONSTRAINT IF EXISTS agent_activity_log_agent_type_check;

ALTER TABLE agent_activity_log
ADD CONSTRAINT agent_activity_log_agent_type_check
CHECK (agent_type IN (
    'orchestrator', 'conversation', 'research',
    'qualification', 'personalization', 'video', 'voice', 'crm',
    'messaging', 'openclaw'
));
