-- People Data Labs Enrichment Table
-- Stores enriched person data from PDL API for research agent
-- ============================================================================

-- ============================================================================
-- PDL Person Enrichment Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS pdl_person_enrichment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to networking contact
    contact_id UUID REFERENCES networking_contacts(id) ON DELETE CASCADE,

    -- PDL Identifiers
    pdl_id TEXT UNIQUE,  -- PDL persistent ID

    -- Match Quality
    likelihood INTEGER CHECK (likelihood BETWEEN 1 AND 10),
    matched_on TEXT[],  -- Fields that matched (email, phone, linkedin, etc.)

    -- Basic Identity
    full_name TEXT,
    first_name TEXT,
    middle_name TEXT,
    last_name TEXT,
    birth_year INTEGER,
    birth_date DATE,
    sex TEXT CHECK (sex IN ('male', 'female')),

    -- Contact Information (from PDL)
    work_email TEXT,
    personal_emails TEXT[],
    recommended_personal_email TEXT,
    mobile_phone TEXT,
    phone_numbers TEXT[],

    -- Current Job
    job_title TEXT,
    job_title_role TEXT,
    job_title_sub_role TEXT,
    job_title_levels TEXT[],  -- e.g., ['manager', 'director']
    job_start_date DATE,
    inferred_salary TEXT,  -- Range like "$100,000 - $150,000"
    inferred_years_experience INTEGER,

    -- Current Company
    job_company_name TEXT,
    job_company_id TEXT,
    job_company_website TEXT,
    job_company_linkedin_url TEXT,
    job_company_size TEXT,  -- e.g., "1001-5000"
    job_company_industry TEXT,
    job_company_type TEXT,  -- e.g., "private", "public"
    job_company_founded INTEGER,
    job_company_location TEXT,
    job_company_employee_count INTEGER,
    job_company_inferred_revenue TEXT,

    -- Location
    location_name TEXT,
    location_locality TEXT,  -- City
    location_region TEXT,    -- State
    location_country TEXT,
    location_postal_code TEXT,
    location_street_address TEXT,
    location_geo POINT,      -- PostgreSQL point type for lat/lng

    -- Social Profiles
    linkedin_url TEXT,
    linkedin_id TEXT,
    linkedin_username TEXT,
    linkedin_connections INTEGER,
    twitter_url TEXT,
    twitter_username TEXT,
    github_url TEXT,
    github_username TEXT,
    facebook_url TEXT,

    -- Arrays stored as JSONB for flexibility
    experience JSONB DEFAULT '[]'::jsonb,     -- Work history array
    education JSONB DEFAULT '[]'::jsonb,      -- Education array
    certifications JSONB DEFAULT '[]'::jsonb, -- Certifications array
    skills TEXT[],
    interests TEXT[],
    languages JSONB DEFAULT '[]'::jsonb,      -- [{name, proficiency}]
    profiles JSONB DEFAULT '[]'::jsonb,       -- All social profiles

    -- Data Quality Metadata
    num_sources INTEGER,
    num_records INTEGER,
    first_seen DATE,
    last_seen DATE,
    dataset_version TEXT,

    -- Raw API Response (for reference/debugging)
    raw_response JSONB,

    -- Timestamps
    enriched_at TIMESTAMPTZ DEFAULT NOW(),
    last_refreshed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- PDL Company Enrichment Table (for standalone company lookups)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pdl_company_enrichment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Link to networking contact (optional)
    contact_id UUID REFERENCES networking_contacts(id) ON DELETE SET NULL,

    -- PDL Company Identifiers
    pdl_company_id TEXT UNIQUE,

    -- Basic Company Info
    name TEXT NOT NULL,
    display_name TEXT,
    website TEXT,
    size TEXT,
    employee_count INTEGER,
    employee_count_by_country JSONB,

    -- Industry & Classification
    industry TEXT,
    naics_code TEXT,
    sic_code TEXT,
    tags TEXT[],

    -- Financial
    type TEXT,  -- private, public, nonprofit, etc.
    founded INTEGER,
    inferred_revenue TEXT,
    total_funding_raised BIGINT,
    latest_funding_stage TEXT,

    -- Location
    location_name TEXT,
    location_locality TEXT,
    location_region TEXT,
    location_country TEXT,
    location_street_address TEXT,
    location_postal_code TEXT,
    location_geo POINT,

    -- Social & Web Presence
    linkedin_url TEXT,
    linkedin_id TEXT,
    twitter_url TEXT,
    facebook_url TEXT,

    -- Relationships
    affiliated_entities JSONB DEFAULT '[]'::jsonb,  -- Parent/subsidiary

    -- Raw Response
    raw_response JSONB,

    -- Timestamps
    enriched_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Person enrichment indexes
CREATE INDEX IF NOT EXISTS idx_pdl_person_contact_id ON pdl_person_enrichment(contact_id);
CREATE INDEX IF NOT EXISTS idx_pdl_person_pdl_id ON pdl_person_enrichment(pdl_id);
CREATE INDEX IF NOT EXISTS idx_pdl_person_linkedin ON pdl_person_enrichment(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_pdl_person_work_email ON pdl_person_enrichment(work_email);
CREATE INDEX IF NOT EXISTS idx_pdl_person_company ON pdl_person_enrichment(job_company_name);
CREATE INDEX IF NOT EXISTS idx_pdl_person_enriched_at ON pdl_person_enrichment(enriched_at DESC);

-- Company enrichment indexes
CREATE INDEX IF NOT EXISTS idx_pdl_company_contact_id ON pdl_company_enrichment(contact_id);
CREATE INDEX IF NOT EXISTS idx_pdl_company_name ON pdl_company_enrichment(name);
CREATE INDEX IF NOT EXISTS idx_pdl_company_website ON pdl_company_enrichment(website);
CREATE INDEX IF NOT EXISTS idx_pdl_company_linkedin ON pdl_company_enrichment(linkedin_url);

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update updated_at for person enrichment
DROP TRIGGER IF EXISTS update_pdl_person_updated_at ON pdl_person_enrichment;
CREATE TRIGGER update_pdl_person_updated_at
    BEFORE UPDATE ON pdl_person_enrichment
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at for company enrichment
DROP TRIGGER IF EXISTS update_pdl_company_updated_at ON pdl_company_enrichment;
CREATE TRIGGER update_pdl_company_updated_at
    BEFORE UPDATE ON pdl_company_enrichment
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE pdl_person_enrichment IS 'Enriched person data from People Data Labs API';
COMMENT ON TABLE pdl_company_enrichment IS 'Enriched company data from People Data Labs API';

COMMENT ON COLUMN pdl_person_enrichment.likelihood IS 'PDL match confidence score (1-10)';
COMMENT ON COLUMN pdl_person_enrichment.experience IS 'Work history as JSONB array';
COMMENT ON COLUMN pdl_person_enrichment.education IS 'Education history as JSONB array';
COMMENT ON COLUMN pdl_person_enrichment.raw_response IS 'Full PDL API response for debugging';
