-- Migration 108: Content setup wizard + image generation fields

-- Setup wizard completion flag per client
ALTER TABLE content_settings ADD COLUMN IF NOT EXISTS wizard_completed BOOLEAN DEFAULT false;

-- Image generation tracking on posts
ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS featured_image_prompt TEXT;
ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS featured_image_source TEXT; -- 'ai_generated' | 'uploaded' | 'url'
ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS image_generation_error TEXT;

-- Auto-trigger image generation when post is created
ALTER TABLE agency_settings ADD COLUMN IF NOT EXISTS image_generation_enabled BOOLEAN DEFAULT false;
