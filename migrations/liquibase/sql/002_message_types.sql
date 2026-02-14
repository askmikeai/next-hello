-- Message Types Migration
-- Adds support for different WhatsApp message types: text, image, video, audio, document, sticker, location

-- ============================================================================
-- Add message_type column
-- ============================================================================
ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'
CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location'));

-- ============================================================================
-- Media fields
-- ============================================================================
ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS media_mimetype TEXT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS media_size_bytes BIGINT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS media_duration_seconds INTEGER;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS media_width INTEGER;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS media_height INTEGER;

-- ============================================================================
-- Location fields
-- ============================================================================
ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS location_name TEXT;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS location_address TEXT;

-- ============================================================================
-- Message type flags
-- ============================================================================
ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS is_voice_note BOOLEAN DEFAULT FALSE;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS is_video_note BOOLEAN DEFAULT FALSE;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS is_gif BOOLEAN DEFAULT FALSE;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN DEFAULT FALSE;

ALTER TABLE message_history
ADD COLUMN IF NOT EXISTS is_animated BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- Indexes for efficient querying by message type
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_message_history_type ON message_history(message_type);
CREATE INDEX IF NOT EXISTS idx_message_history_view_once ON message_history(is_view_once) WHERE is_view_once = TRUE;

-- ============================================================================
-- Make content nullable (media messages may not have text)
-- ============================================================================
ALTER TABLE message_history
ALTER COLUMN content DROP NOT NULL;

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON COLUMN message_history.message_type IS 'Type of message: text, image, video, audio, document, sticker, location';
COMMENT ON COLUMN message_history.media_url IS 'WhatsApp media directPath for downloading';
COMMENT ON COLUMN message_history.media_mimetype IS 'MIME type of media (e.g., audio/ogg, video/mp4)';
COMMENT ON COLUMN message_history.media_size_bytes IS 'File size in bytes';
COMMENT ON COLUMN message_history.media_duration_seconds IS 'Duration for audio/video in seconds';
COMMENT ON COLUMN message_history.media_width IS 'Width in pixels for image/video';
COMMENT ON COLUMN message_history.media_height IS 'Height in pixels for image/video';
COMMENT ON COLUMN message_history.location_latitude IS 'Latitude for location messages';
COMMENT ON COLUMN message_history.location_longitude IS 'Longitude for location messages';
COMMENT ON COLUMN message_history.location_name IS 'Place name for location messages';
COMMENT ON COLUMN message_history.location_address IS 'Address for location messages';
COMMENT ON COLUMN message_history.is_voice_note IS 'TRUE if audio is a voice note (ptt)';
COMMENT ON COLUMN message_history.is_video_note IS 'TRUE if video is a video note (ptv/circular)';
COMMENT ON COLUMN message_history.is_gif IS 'TRUE if video should play as GIF';
COMMENT ON COLUMN message_history.is_view_once IS 'TRUE if message is view-once';
COMMENT ON COLUMN message_history.is_animated IS 'TRUE if sticker is animated';
