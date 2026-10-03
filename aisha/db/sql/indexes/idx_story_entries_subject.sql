-- Index: idx_story_entries_subject
-- Polymorphic subject lookup for get_discussion_entries (subject_type, subject_id).

CREATE INDEX idx_story_entries_subject ON story_entries (subject_type, subject_id);
