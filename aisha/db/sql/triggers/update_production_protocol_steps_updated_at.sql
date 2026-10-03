-- Trigger: update_production_protocol_steps_updated_at
-- Table: production_protocol_steps

CREATE TRIGGER update_production_protocol_steps_updated_at
    BEFORE UPDATE ON public.production_protocol_steps
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
