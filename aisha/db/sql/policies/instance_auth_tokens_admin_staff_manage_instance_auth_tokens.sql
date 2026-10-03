-- Policy: admin_staff_manage_instance_auth_tokens ON public.instance_auth_tokens
-- Auto-extracted (back-port reconciliation)

DROP POLICY IF EXISTS "admin_staff_manage_instance_auth_tokens" ON public.instance_auth_tokens;
CREATE POLICY "admin_staff_manage_instance_auth_tokens" ON public.instance_auth_tokens AS PERMISSIVE FOR ALL TO public USING ((SELECT is_admin_or_staff()));
