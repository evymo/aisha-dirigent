-- Trigger: app_role_permissions_audit
-- Table: app_role_permissions

CREATE TRIGGER app_role_permissions_audit
AFTER INSERT OR DELETE
ON public.app_role_permissions
FOR EACH ROW
EXECUTE FUNCTION log_permission_change();
