-- Index: idx_archive_tags_category
-- Table: archive_tags

CREATE INDEX IF NOT EXISTS idx_archive_tags_category ON public.archive_tags(category);
