-- Policy: Admins can manage campaign runs

DROP POLICY IF EXISTS "Admins can manage campaign runs" ON public.notification_campaign_runs;
CREATE POLICY "Admins can manage campaign runs" ON public.notification_campaign_runs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
