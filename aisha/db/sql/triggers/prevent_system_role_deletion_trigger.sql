-- Trigger: prevent_system_role_deletion_trigger
-- Table: roles

CREATE TRIGGER prevent_system_role_deletion_trigger
BEFORE DELETE
ON public.roles
FOR EACH ROW
EXECUTE FUNCTION prevent_system_role_deletion();
