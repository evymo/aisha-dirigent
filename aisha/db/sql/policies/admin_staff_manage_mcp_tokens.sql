-- Policy: admin_staff_manage_mcp_tokens

DROP POLICY IF EXISTS "admin_staff_manage_mcp_tokens" ON public.mcp_auth_tokens;
CREATE POLICY "admin_staff_manage_mcp_tokens" ON public.mcp_auth_tokens
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
