-- Trigger: update_role_definitions_updated_at
-- Table: role_definitions

CREATE TRIGGER update_role_definitions_updated_at
BEFORE UPDATE
ON public.role_definitions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
