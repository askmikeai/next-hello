-- Telegram Support Migration
-- Adds Telegram-specific columns to networking_contacts for Telegram channel integration

-- ============================================================================
-- Add Telegram columns to networking_contacts
-- ============================================================================

-- Telegram user ID (unique identifier for the user in Telegram)
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT;

-- Telegram chat ID (the chat/conversation ID - may differ from user ID for groups)
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;

-- Telegram username (e.g., @johndoe - without the @ symbol)
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS telegram_username TEXT;

-- ============================================================================
-- Indexes for efficient lookups
-- ============================================================================

-- Index for looking up contacts by Telegram user ID
CREATE INDEX IF NOT EXISTS idx_contacts_telegram_user_id
ON networking_contacts(telegram_user_id)
WHERE telegram_user_id IS NOT NULL;

-- Index for looking up contacts by Telegram chat ID
CREATE INDEX IF NOT EXISTS idx_contacts_telegram_chat_id
ON networking_contacts(telegram_chat_id)
WHERE telegram_chat_id IS NOT NULL;

-- Index for looking up contacts by Telegram username
CREATE INDEX IF NOT EXISTS idx_contacts_telegram_username
ON networking_contacts(telegram_username)
WHERE telegram_username IS NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON COLUMN networking_contacts.telegram_user_id IS 'Telegram user ID (unique identifier)';
COMMENT ON COLUMN networking_contacts.telegram_chat_id IS 'Telegram chat/conversation ID';
COMMENT ON COLUMN networking_contacts.telegram_username IS 'Telegram username without @ symbol';
