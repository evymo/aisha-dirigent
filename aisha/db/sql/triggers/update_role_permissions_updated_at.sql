-- Trigger: update_role_permissions_updated_at
-- Table: role_permissions

CREATE TRIGGER update_role_permissions_updated_at
    BEFORE UPDATE ON public.role_permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
