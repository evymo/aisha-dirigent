-- Trigger: set_story_sync_policies_updated_at
-- Table: story_sync_policies

CREATE TRIGGER set_story_sync_policies_updated_at
    BEFORE UPDATE ON public.story_sync_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
