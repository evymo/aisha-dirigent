-- Trigger: update_li_obligations_updated_at
-- Table: li_obligations

CREATE TRIGGER update_li_obligations_updated_at
    BEFORE UPDATE ON public.li_obligations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
