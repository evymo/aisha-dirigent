-- Policy: Admins can manage notification campaigns

DROP POLICY IF EXISTS "Admins can manage notification campaigns" ON public.notification_campaigns;
CREATE POLICY "Admins can manage notification campaigns" ON public.notification_campaigns
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
