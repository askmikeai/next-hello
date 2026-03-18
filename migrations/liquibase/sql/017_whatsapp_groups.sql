-- WhatsApp group persistence
-- Stores observed group metadata, members, and message context for UI and auditing

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS chat_jid TEXT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS group_jid TEXT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS group_subject TEXT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS participant_jid TEXT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS bot_is_group_admin BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_message_history_owner_group_created
ON message_history(owner_id, group_jid, created_at DESC)
WHERE group_jid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_history_chat_jid_created
ON message_history(chat_jid, created_at DESC)
WHERE chat_jid IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    subject TEXT,
    participant_count INTEGER NOT NULL DEFAULT 0,
    bot_is_member BOOLEAN NOT NULL DEFAULT TRUE,
    bot_is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_owner_updated
ON whatsapp_groups(owner_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_owner_admin
ON whatsapp_groups(owner_id, bot_is_admin);

CREATE TABLE IF NOT EXISTS whatsapp_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    member_jid TEXT NOT NULL,
    phone_number TEXT,
    display_name TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, group_jid, member_jid)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_members_owner_group
ON whatsapp_group_members(owner_id, group_jid, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_group_members_phone
ON whatsapp_group_members(phone_number)
WHERE phone_number IS NOT NULL;

COMMENT ON TABLE whatsapp_groups IS 'Observed WhatsApp groups per owner session';
COMMENT ON TABLE whatsapp_group_members IS 'Observed WhatsApp group members and roles';
COMMENT ON COLUMN message_history.chat_jid IS 'Chat JID for the message (group or direct JID)';
COMMENT ON COLUMN message_history.is_group IS 'TRUE when the message belongs to a WhatsApp group chat';
COMMENT ON COLUMN message_history.group_jid IS 'WhatsApp group JID when is_group is TRUE';
COMMENT ON COLUMN message_history.group_subject IS 'Observed group subject at message time';
COMMENT ON COLUMN message_history.participant_jid IS 'Sender participant JID inside a group chat';
COMMENT ON COLUMN message_history.bot_is_group_admin IS 'Whether the bot session was a group admin when handling the message';
