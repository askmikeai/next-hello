-- Media Files Table for GDPR-compliant storage tracking
-- Tracks all media files stored for contacts with full audit trail

CREATE TABLE IF NOT EXISTS media_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Contact reference (nullable for unlinked media)
    contact_id UUID REFERENCES networking_contacts(id) ON DELETE SET NULL,
    phone_number TEXT NOT NULL,

    -- Storage location
    storage_key TEXT NOT NULL UNIQUE,
    storage_backend TEXT NOT NULL DEFAULT 'local',

    -- File metadata
    media_type TEXT NOT NULL,  -- voice, video, image, document, avatar
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum_sha256 TEXT,

    -- Source tracking
    source TEXT NOT NULL,  -- generated, uploaded, received, downloaded
    source_url TEXT,

    -- Retention policy
    retention_policy TEXT DEFAULT 'standard',  -- temporary, standard, extended, permanent
    expires_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    accessed_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,  -- Soft delete for GDPR audit trail

    -- Constraints
    CONSTRAINT valid_media_type CHECK (media_type IN ('voice', 'video', 'image', 'document', 'avatar')),
    CONSTRAINT valid_source CHECK (source IN ('generated', 'uploaded', 'received', 'downloaded')),
    CONSTRAINT valid_retention CHECK (retention_policy IN ('temporary', 'standard', 'extended', 'permanent')),
    CONSTRAINT valid_backend CHECK (storage_backend IN ('local', 's3', 'r2'))
);

-- Index for GDPR queries: find all media by phone number
CREATE INDEX IF NOT EXISTS idx_media_files_phone_number
    ON media_files(phone_number)
    WHERE deleted_at IS NULL;

-- Index for contact media lookup
CREATE INDEX IF NOT EXISTS idx_media_files_contact_id
    ON media_files(contact_id)
    WHERE deleted_at IS NULL AND contact_id IS NOT NULL;

-- Index for retention cleanup jobs
CREATE INDEX IF NOT EXISTS idx_media_files_expires_at
    ON media_files(expires_at)
    WHERE deleted_at IS NULL AND expires_at IS NOT NULL;

-- Index for deleted files (audit trail)
CREATE INDEX IF NOT EXISTS idx_media_files_deleted_at
    ON media_files(deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Index for media type filtering
CREATE INDEX IF NOT EXISTS idx_media_files_media_type
    ON media_files(media_type, phone_number)
    WHERE deleted_at IS NULL;


-- Function: Get all media for a contact (GDPR Right to Access)
CREATE OR REPLACE FUNCTION get_contact_media(
    p_phone_number TEXT
)
RETURNS TABLE (
    id UUID,
    contact_id UUID,
    phone_number TEXT,
    storage_key TEXT,
    storage_backend TEXT,
    media_type TEXT,
    mime_type TEXT,
    size_bytes BIGINT,
    source TEXT,
    retention_policy TEXT,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    accessed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.contact_id,
        m.phone_number,
        m.storage_key,
        m.storage_backend,
        m.media_type,
        m.mime_type,
        m.size_bytes,
        m.source,
        m.retention_policy,
        m.expires_at,
        m.created_at,
        m.accessed_at
    FROM media_files m
    WHERE m.phone_number = p_phone_number
      AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC;
END;
$$;


-- Function: Soft delete all media for a contact (GDPR Right to Erasure)
CREATE OR REPLACE FUNCTION soft_delete_contact_media(
    p_phone_number TEXT
)
RETURNS TABLE (
    files_deleted BIGINT,
    total_size_bytes BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_files_deleted BIGINT;
    v_total_size BIGINT;
BEGIN
    -- Get stats before deletion
    SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
    INTO v_files_deleted, v_total_size
    FROM media_files
    WHERE phone_number = p_phone_number
      AND deleted_at IS NULL;

    -- Soft delete all files
    UPDATE media_files
    SET deleted_at = NOW()
    WHERE phone_number = p_phone_number
      AND deleted_at IS NULL;

    RETURN QUERY SELECT v_files_deleted, v_total_size;
END;
$$;


-- Function: Clean up expired files
CREATE OR REPLACE FUNCTION cleanup_expired_media()
RETURNS TABLE (
    files_deleted BIGINT,
    total_size_bytes BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_files_deleted BIGINT;
    v_total_size BIGINT;
BEGIN
    -- Get stats before cleanup
    SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
    INTO v_files_deleted, v_total_size
    FROM media_files
    WHERE expires_at < NOW()
      AND deleted_at IS NULL
      AND retention_policy != 'permanent';

    -- Soft delete expired files
    UPDATE media_files
    SET deleted_at = NOW()
    WHERE expires_at < NOW()
      AND deleted_at IS NULL
      AND retention_policy != 'permanent';

    RETURN QUERY SELECT v_files_deleted, v_total_size;
END;
$$;


-- Function: Get storage statistics
CREATE OR REPLACE FUNCTION get_media_storage_stats()
RETURNS TABLE (
    total_files BIGINT,
    total_size_bytes BIGINT,
    files_by_type JSONB,
    files_by_backend JSONB,
    files_expiring_soon BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT AS total_files,
        COALESCE(SUM(m.size_bytes), 0)::BIGINT AS total_size_bytes,
        (
            SELECT jsonb_object_agg(media_type, cnt)
            FROM (
                SELECT media_type, COUNT(*) as cnt
                FROM media_files
                WHERE deleted_at IS NULL
                GROUP BY media_type
            ) sub
        ) AS files_by_type,
        (
            SELECT jsonb_object_agg(storage_backend, cnt)
            FROM (
                SELECT storage_backend, COUNT(*) as cnt
                FROM media_files
                WHERE deleted_at IS NULL
                GROUP BY storage_backend
            ) sub
        ) AS files_by_backend,
        (
            SELECT COUNT(*)
            FROM media_files
            WHERE deleted_at IS NULL
              AND expires_at IS NOT NULL
              AND expires_at < NOW() + INTERVAL '7 days'
        )::BIGINT AS files_expiring_soon
    FROM media_files m
    WHERE m.deleted_at IS NULL;
END;
$$;
