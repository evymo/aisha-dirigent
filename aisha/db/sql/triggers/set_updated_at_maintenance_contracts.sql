-- Trigger: set_updated_at_maintenance_contracts
-- Table: maintenance_contracts

CREATE TRIGGER set_updated_at_maintenance_contracts
    BEFORE UPDATE ON public.maintenance_contracts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

