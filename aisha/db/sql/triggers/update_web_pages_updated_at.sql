-- Trigger: update_web_pages_updated_at
-- Table: web_pages

CREATE TRIGGER update_web_pages_updated_at
    BEFORE UPDATE ON public.web_pages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
