-- RLS Policies for app_secrets
-- Source of truth: supabase/sql/policies/

-- Only admins can manage secrets (includes SELECT, INSERT, UPDATE, DELETE)
DROP POLICY IF EXISTS "Admins can manage secrets" ON public.app_secrets;
CREATE POLICY "Admins can manage secrets" ON public.app_secrets
  FOR ALL USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
