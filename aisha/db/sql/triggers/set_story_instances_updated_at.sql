-- Trigger: set_story_instances_updated_at
-- Table: story_instances

CREATE TRIGGER set_story_instances_updated_at
    BEFORE UPDATE ON public.story_instances
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
