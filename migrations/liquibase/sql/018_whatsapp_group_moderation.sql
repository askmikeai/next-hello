-- WhatsApp group moderation persistence

CREATE TABLE IF NOT EXISTS whatsapp_group_moderation_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    participant_jid TEXT NOT NULL,
    participant_phone_number TEXT,
    message_id TEXT NOT NULL,
    message_content TEXT,
    matched_guideline TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_group_violations_lookup
ON whatsapp_group_moderation_violations(owner_id, group_jid, participant_jid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_group_violations_message
ON whatsapp_group_moderation_violations(message_id);

CREATE TABLE IF NOT EXISTS whatsapp_group_moderation_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    participant_jid TEXT,
    participant_phone_number TEXT,
    message_id TEXT,
    action_type TEXT NOT NULL CHECK (action_type IN ('warn', 'delete', 'kick', 'skip')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'skipped')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_group_actions_lookup
ON whatsapp_group_moderation_actions(owner_id, group_jid, participant_jid, created_at DESC);

COMMENT ON TABLE whatsapp_group_moderation_violations IS 'Per-group moderation violations used for strike escalation';
COMMENT ON TABLE whatsapp_group_moderation_actions IS 'Audit log of moderation actions taken in WhatsApp groups';
