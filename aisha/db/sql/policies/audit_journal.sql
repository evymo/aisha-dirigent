-- RLS Policies for audit_journal
-- Source of truth: supabase/sql/policies/

-- Admins and staff can view audit journal
DROP POLICY IF EXISTS "Admins and staff can view audit journal" ON public.audit_journal;
CREATE POLICY "Admins and staff can view audit journal" ON public.audit_journal
  FOR SELECT USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
