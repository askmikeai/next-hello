-- Backend-managed user accounts with approval workflow.
-- All new signups start as 'pending' and must be approved by an admin.

CREATE TABLE IF NOT EXISTS user_accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    is_admin    BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
CREATE INDEX IF NOT EXISTS idx_user_accounts_owner_id ON user_accounts(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON user_accounts(status);

-- Seed askmikeai as approved admin
INSERT INTO user_accounts (owner_id, name, email, password, status, is_admin)
VALUES (
    'askmikeai-gmail.com',
    'Michael Friedberg',
    'askmikeai@gmail.com',
    'NextHello2026!',
    'approved',
    true
) ON CONFLICT (email) DO NOTHING;
