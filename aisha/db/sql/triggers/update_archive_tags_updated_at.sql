-- Trigger: update_archive_tags_updated_at
-- Table: archive_tags

CREATE TRIGGER update_archive_tags_updated_at
    BEFORE UPDATE ON public.archive_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
