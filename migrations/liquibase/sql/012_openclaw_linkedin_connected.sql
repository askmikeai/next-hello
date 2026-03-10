-- Track whether OpenClaw already connected on LinkedIn for a contact

ALTER TABLE networking_contacts
ADD COLUMN IF NOT EXISTS open_claw_linkedin_connected BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_open_claw_linkedin_connected
ON networking_contacts(open_claw_linkedin_connected);
