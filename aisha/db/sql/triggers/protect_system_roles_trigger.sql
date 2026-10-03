-- Trigger: protect_system_roles_trigger
-- Table: roles

CREATE TRIGGER protect_system_roles_trigger
BEFORE UPDATE
ON public.roles
FOR EACH ROW
EXECUTE FUNCTION protect_system_roles();
