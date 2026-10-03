-- Policy: Admins can view campaign schedules

DROP POLICY IF EXISTS "Admins can view campaign schedules" ON public.notification_campaign_schedules;
CREATE POLICY "Admins can view campaign schedules" ON public.notification_campaign_schedules
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
