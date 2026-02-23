-- WhatsApp Session Storage
-- Stores whatsapp-web.js sessions in PostgreSQL for persistence across containers and environments

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    session_id TEXT PRIMARY KEY,
    session_data TEXT NOT NULL,  -- Base64 encoded tar.gz of Chromium profile
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups by update time
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_updated ON whatsapp_sessions(updated_at);

COMMENT ON TABLE whatsapp_sessions IS 'Stores WhatsApp Web sessions for whatsapp-web.js persistence';
