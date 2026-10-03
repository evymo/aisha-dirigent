-- Index: idx_archive_tags_active
-- Table: archive_tags

CREATE INDEX IF NOT EXISTS idx_archive_tags_active ON public.archive_tags(is_active) WHERE is_active = TRUE;
