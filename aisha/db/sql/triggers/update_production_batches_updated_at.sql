-- Trigger: update_production_batches_updated_at
-- Table: production_batches

CREATE TRIGGER update_production_batches_updated_at
    BEFORE UPDATE ON public.production_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
