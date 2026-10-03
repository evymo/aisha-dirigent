-- Trigger: trg_story_labels_validate_resource
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_story_labels_validate_resource BEFORE INSERT OR UPDATE OF resource_type, resource_id ON public.story_labels FOR EACH ROW EXECUTE FUNCTION audience_story_labels_validate_resource();
