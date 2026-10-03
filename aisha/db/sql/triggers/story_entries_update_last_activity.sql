-- Trigger: story_entries_update_last_activity
-- Table: story_entries

CREATE TRIGGER story_entries_update_last_activity
AFTER INSERT
ON public.story_entries
FOR EACH ROW
EXECUTE FUNCTION update_story_last_activity();
