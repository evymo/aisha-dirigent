-- Index: idx_archive_tags_usage
-- Table: archive_tags

CREATE INDEX IF NOT EXISTS idx_archive_tags_usage ON public.archive_tags(usage_count DESC);
