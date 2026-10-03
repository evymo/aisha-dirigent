-- Trigger: story_entries_mirror_subject
-- Table: story_entries
-- Mirrors the legacy story_id into the polymorphic (subject_type, subject_id) axis
-- BEFORE INSERT so legacy story_id-only rows (seed + app) satisfy the NOT NULL
-- subject_id constraint. Must fire BEFORE the row is checked.

CREATE TRIGGER story_entries_mirror_subject
BEFORE INSERT
ON public.story_entries
FOR EACH ROW
EXECUTE FUNCTION mirror_story_entries_subject();
