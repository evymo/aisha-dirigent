-- Trigger: audit_role_changes_trigger
-- Table: roles

CREATE TRIGGER audit_role_changes_trigger
AFTER DELETE OR UPDATE OR INSERT
ON public.roles
FOR EACH ROW
EXECUTE FUNCTION audit_role_changes();
