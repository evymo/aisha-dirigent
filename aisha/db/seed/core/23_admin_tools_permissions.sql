-- =============================================================================
-- 23_admin_tools_permissions.sql — Admin Tools Access Permissions
-- =============================================================================
-- Permission codes for controlling access to admin infrastructure services
-- (PostgreSQL admin console, n8n) via OAuth2 Proxy + Keycloak OIDC.
--
-- These permissions are synced to Keycloak realm roles by the
-- keycloak-role-sync edge function. Granting/revoking these permissions
-- in the Admin Panel automatically updates Keycloak access.
-- =============================================================================

-- ── Permission definitions ───────────────────────────────────────────────────
INSERT INTO public.permissions (code, name, description, category, is_system)
VALUES
  ('access_studio', 'Access Database Studio', 'Grants access to the PostgreSQL database dashboard via OAuth2 Proxy + Keycloak SSO', 'admin_tools', true),
  ('access_n8n', 'Access n8n Workflows', 'Grants access to n8n workflow engine dashboard via OAuth2 Proxy + Keycloak SSO', 'admin_tools', true)
ON CONFLICT (code) DO NOTHING;

-- ── Default grants: admin role ───────────────────────────────────────────────
-- Admin gets access to all admin tools by default.
-- Other roles can be granted access via the Admin Panel (AdminPermissions.tsx).
INSERT INTO public.app_role_permissions (role, permission_id, granted_by)
SELECT 'admin'::public.app_role, p.id, '00000000-0000-0000-0000-000000000001'::uuid
FROM public.permissions p
WHERE p.code IN ('access_studio', 'access_n8n')
  AND NOT EXISTS (
    SELECT 1 FROM public.app_role_permissions arp
    WHERE arp.role = 'admin'::public.app_role AND arp.permission_id = p.id
  );
