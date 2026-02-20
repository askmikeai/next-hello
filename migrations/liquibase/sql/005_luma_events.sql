-- Luma Events Database Migration
-- Creates tables for storing Luma events, guests, and associations with contacts

-- ============================================================================
-- Luma Events Table
-- Stores scraped event data from lu.ma
-- ============================================================================
CREATE TABLE IF NOT EXISTS luma_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,           -- e.g., "ddfjmykw"
    name TEXT NOT NULL,
    url TEXT NOT NULL,

    -- Event timing
    event_date TIMESTAMPTZ,
    event_end_date TIMESTAMPTZ,
    timezone TEXT,

    -- Location
    location TEXT,
    location_address TEXT,
    is_online BOOLEAN DEFAULT false,

    -- Content
    description TEXT,
    cover_image_url TEXT,

    -- Host info (primary host, others in luma_event_guests)
    host_name TEXT,

    guest_count INTEGER DEFAULT 0,

    -- Scraping metadata
    scraped_at TIMESTAMPTZ,
    scrape_status TEXT DEFAULT 'pending' CHECK (scrape_status IN (
        'pending', 'in_progress', 'complete', 'failed', 'partial'
    )),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_luma_events_slug ON luma_events(slug);
CREATE INDEX IF NOT EXISTS idx_luma_events_date ON luma_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_luma_events_scraped ON luma_events(scraped_at DESC);

-- ============================================================================
-- Luma Guests Table
-- Stores guest profiles discovered from events
-- ============================================================================
CREATE TABLE IF NOT EXISTS luma_guests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    luma_user_id TEXT UNIQUE,            -- e.g., "usr-2HMCK2GI35rMLDQ" or "giannidalerta"
    luma_profile_url TEXT NOT NULL,

    -- Profile info
    name TEXT NOT NULL,
    bio TEXT,

    -- Social links (extracted from guest list)
    instagram_url TEXT,
    twitter_url TEXT,
    linkedin_url TEXT,
    website_url TEXT,

    -- Derived handles (extracted from URLs)
    instagram_handle TEXT,
    twitter_handle TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_luma_guests_user_id ON luma_guests(luma_user_id);
CREATE INDEX IF NOT EXISTS idx_luma_guests_name ON luma_guests(name);
CREATE INDEX IF NOT EXISTS idx_luma_guests_instagram ON luma_guests(instagram_handle);
CREATE INDEX IF NOT EXISTS idx_luma_guests_twitter ON luma_guests(twitter_handle);

-- ============================================================================
-- Luma Event Guests Junction Table
-- Links guests to events they attended
-- ============================================================================
CREATE TABLE IF NOT EXISTS luma_event_guests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES luma_events(id) ON DELETE CASCADE,
    guest_id UUID NOT NULL REFERENCES luma_guests(id) ON DELETE CASCADE,

    -- Guest role at event
    is_featured BOOLEAN DEFAULT false,
    is_host BOOLEAN DEFAULT false,

    -- Discovery metadata
    discovered_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint
    UNIQUE(event_id, guest_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_guests_event ON luma_event_guests(event_id);
CREATE INDEX IF NOT EXISTS idx_event_guests_guest ON luma_event_guests(guest_id);

-- ============================================================================
-- Contact Luma Associations Table
-- Links networking_contacts to luma_guests when matched
-- ============================================================================
CREATE TABLE IF NOT EXISTS contact_luma_associations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES networking_contacts(id) ON DELETE CASCADE,
    guest_id UUID NOT NULL REFERENCES luma_guests(id) ON DELETE CASCADE,

    -- The event where the match was discovered
    matched_at_event_id UUID REFERENCES luma_events(id) ON DELETE SET NULL,

    -- Match details
    match_score NUMERIC(4,3),            -- 0.000 to 1.000
    match_type TEXT DEFAULT 'automatic' CHECK (match_type IN (
        'exact',      -- Exact name match
        'fuzzy',      -- Fuzzy name match above threshold
        'manual',     -- User manually linked
        'automatic'   -- System matched
    )),
    match_reason TEXT,                   -- e.g., "first_name_match", "full_name_match"

    -- Verification
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    verified_by TEXT,                    -- 'user' or 'system'

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint - one link per contact-guest pair
    UNIQUE(contact_id, guest_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contact_luma_contact ON contact_luma_associations(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_luma_guest ON contact_luma_associations(guest_id);
CREATE INDEX IF NOT EXISTS idx_contact_luma_event ON contact_luma_associations(matched_at_event_id);
CREATE INDEX IF NOT EXISTS idx_contact_luma_verified ON contact_luma_associations(verified);

-- ============================================================================
-- Add Luma reference to networking_contacts
-- ============================================================================
ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS luma_guest_id UUID REFERENCES luma_guests(id) ON DELETE SET NULL;

ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS luma_matched_at TIMESTAMPTZ;

-- Index for Luma lookups
CREATE INDEX IF NOT EXISTS idx_contacts_luma_guest ON networking_contacts(luma_guest_id);

-- ============================================================================
-- User's Luma Events (events user is attending)
-- ============================================================================
CREATE TABLE IF NOT EXISTS luma_user_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES luma_events(id) ON DELETE CASCADE,

    -- User's relationship to event
    relationship TEXT DEFAULT 'attending' CHECK (relationship IN (
        'attending', 'attended', 'hosting', 'hosted', 'interested'
    )),

    -- Timestamps
    discovered_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(event_id)
);

CREATE INDEX IF NOT EXISTS idx_user_events_relationship ON luma_user_events(relationship);

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Extract Luma user ID from profile URL
CREATE OR REPLACE FUNCTION extract_luma_user_id(profile_url TEXT)
RETURNS TEXT AS $$
BEGIN
    -- URL format: https://lu.ma/user/usr-XXXXX or https://lu.ma/user/username
    RETURN regexp_replace(profile_url, '^https?://lu\.ma/user/', '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Extract handle from social URL
CREATE OR REPLACE FUNCTION extract_social_handle(url TEXT)
RETURNS TEXT AS $$
BEGIN
    IF url IS NULL THEN RETURN NULL; END IF;
    -- Remove trailing slashes and extract last path segment
    RETURN regexp_replace(
        regexp_replace(url, '/$', ''),
        '^.+/', ''
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Find potential matches between contacts and guests
CREATE OR REPLACE FUNCTION find_luma_guest_matches(
    p_contact_id UUID,
    p_threshold NUMERIC DEFAULT 0.7
)
RETURNS TABLE (
    guest_id UUID,
    guest_name TEXT,
    match_score NUMERIC,
    match_reason TEXT
) AS $$
DECLARE
    v_contact RECORD;
BEGIN
    -- Get contact details
    SELECT first_name, last_name, email, twitter_handle, linkedin_url
    INTO v_contact
    FROM networking_contacts
    WHERE id = p_contact_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        g.id as guest_id,
        g.name as guest_name,
        CASE
            -- Exact full name match
            WHEN lower(g.name) = lower(concat(v_contact.first_name, ' ', v_contact.last_name)) THEN 1.0
            -- First name + partial last name
            WHEN lower(g.name) LIKE lower(concat(v_contact.first_name, ' %')) THEN 0.85
            -- First name anywhere
            WHEN lower(g.name) LIKE lower(concat('%', v_contact.first_name, '%')) THEN 0.75
            ELSE 0.0
        END::NUMERIC as match_score,
        CASE
            WHEN lower(g.name) = lower(concat(v_contact.first_name, ' ', v_contact.last_name)) THEN 'full_name_match'
            WHEN lower(g.name) LIKE lower(concat(v_contact.first_name, ' %')) THEN 'first_last_partial'
            WHEN lower(g.name) LIKE lower(concat('%', v_contact.first_name, '%')) THEN 'first_name_contains'
            ELSE 'no_match'
        END as match_reason
    FROM luma_guests g
    WHERE
        -- Only return matches above threshold
        CASE
            WHEN lower(g.name) = lower(concat(v_contact.first_name, ' ', v_contact.last_name)) THEN 1.0
            WHEN lower(g.name) LIKE lower(concat(v_contact.first_name, ' %')) THEN 0.85
            WHEN lower(g.name) LIKE lower(concat('%', v_contact.first_name, '%')) THEN 0.75
            ELSE 0.0
        END >= p_threshold
        -- Exclude already linked
        AND NOT EXISTS (
            SELECT 1 FROM contact_luma_associations cla
            WHERE cla.contact_id = p_contact_id AND cla.guest_id = g.id
        )
    ORDER BY match_score DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-extract handles when guest is inserted/updated
CREATE OR REPLACE FUNCTION extract_guest_handles()
RETURNS TRIGGER AS $$
BEGIN
    NEW.luma_user_id = COALESCE(NEW.luma_user_id, extract_luma_user_id(NEW.luma_profile_url));
    NEW.instagram_handle = extract_social_handle(NEW.instagram_url);
    NEW.twitter_handle = extract_social_handle(NEW.twitter_url);
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_extract_guest_handles ON luma_guests;
CREATE TRIGGER trigger_extract_guest_handles
    BEFORE INSERT OR UPDATE ON luma_guests
    FOR EACH ROW
    EXECUTE FUNCTION extract_guest_handles();

-- Auto-update timestamps on luma_events
DROP TRIGGER IF EXISTS update_luma_events_updated_at ON luma_events;
CREATE TRIGGER update_luma_events_updated_at
    BEFORE UPDATE ON luma_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE luma_events IS 'Events scraped from Luma (lu.ma)';
COMMENT ON TABLE luma_guests IS 'Guest profiles discovered from Luma events';
COMMENT ON TABLE luma_event_guests IS 'Junction table linking guests to events they attended';
COMMENT ON TABLE contact_luma_associations IS 'Links networking contacts to their Luma guest profiles';
COMMENT ON TABLE luma_user_events IS 'Events the user is attending or has attended';

COMMENT ON COLUMN luma_events.slug IS 'Luma event URL slug (e.g., ddfjmykw)';
COMMENT ON COLUMN luma_guests.luma_user_id IS 'User ID from Luma profile URL';
COMMENT ON COLUMN contact_luma_associations.match_score IS 'Name similarity score 0.0-1.0';
COMMENT ON COLUMN networking_contacts.luma_guest_id IS 'Primary Luma guest profile for this contact';
