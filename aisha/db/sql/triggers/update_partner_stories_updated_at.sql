-- Trigger: update_partner_stories_updated_at
-- Table: partner_stories

CREATE TRIGGER update_partner_stories_updated_at
    BEFORE UPDATE ON public.partner_stories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
