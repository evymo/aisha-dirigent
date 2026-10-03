-- Trigger: trg_sync_keycloak_roles
-- Auto-extracted (back-port reconciliation)

CREATE TRIGGER trg_sync_keycloak_roles AFTER INSERT OR DELETE ON public.app_role_permissions FOR EACH ROW EXECUTE FUNCTION fn_sync_keycloak_roles();
