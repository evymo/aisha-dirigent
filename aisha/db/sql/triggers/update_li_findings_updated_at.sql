-- Trigger: update_li_findings_updated_at
-- Table: li_findings

CREATE TRIGGER update_li_findings_updated_at
    BEFORE UPDATE ON public.li_findings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
