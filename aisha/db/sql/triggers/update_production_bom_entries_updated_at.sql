-- Trigger: update_production_bom_entries_updated_at
-- Table: production_bom_entries

CREATE TRIGGER update_production_bom_entries_updated_at
    BEFORE UPDATE ON public.production_bom_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
