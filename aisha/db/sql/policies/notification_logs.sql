-- RLS Policies for notification_logs
-- Source of truth: supabase/sql/policies/

-- Admins can view notification logs
DROP POLICY IF EXISTS "Admins can view notification logs" ON public.notification_logs;
CREATE POLICY "Admins can view notification logs" ON public.notification_logs
  FOR SELECT USING ((SELECT has_role((SELECT auth.uid()), 'admin')));
