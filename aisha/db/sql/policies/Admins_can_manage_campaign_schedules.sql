-- Policy: Admins can manage campaign schedules

DROP POLICY IF EXISTS "Admins can manage campaign schedules" ON public.notification_campaign_schedules;
CREATE POLICY "Admins can manage campaign schedules" ON public.notification_campaign_schedules
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
