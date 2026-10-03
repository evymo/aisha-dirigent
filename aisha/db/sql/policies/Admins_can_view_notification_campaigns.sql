-- Policy: Admins can view notification campaigns

DROP POLICY IF EXISTS "Admins can view notification campaigns" ON public.notification_campaigns;
CREATE POLICY "Admins can view notification campaigns" ON public.notification_campaigns
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
