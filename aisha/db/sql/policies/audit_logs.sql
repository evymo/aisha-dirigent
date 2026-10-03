-- RLS Policies for audit_logs
-- Source of truth: supabase/sql/policies/

-- Admins and staff can view audit logs
DROP POLICY IF EXISTS "Admins and staff can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins and staff can view audit logs" ON public.audit_logs
  FOR SELECT USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

-- No insert/update/delete policies - audit logs should be immutable or handled by system
