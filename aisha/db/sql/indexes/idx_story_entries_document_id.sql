-- Index: idx_story_entries_document_id
-- Table: story_entries

CREATE INDEX IF NOT EXISTS idx_story_entries_document_id ON public.story_entries(document_id);
