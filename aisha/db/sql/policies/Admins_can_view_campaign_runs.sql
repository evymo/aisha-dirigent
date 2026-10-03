-- Policy: Admins can view campaign runs

DROP POLICY IF EXISTS "Admins can view campaign runs" ON public.notification_campaign_runs;
CREATE POLICY "Admins can view campaign runs" ON public.notification_campaign_runs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
