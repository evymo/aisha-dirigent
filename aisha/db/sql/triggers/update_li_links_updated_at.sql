-- Trigger: update_li_links_updated_at
-- Table: li_links

CREATE TRIGGER update_li_links_updated_at
    BEFORE UPDATE ON public.li_links
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
