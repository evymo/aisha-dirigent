-- Policy: Admins can view all subscriptions

DROP POLICY IF EXISTS "Admins can view all subscriptions" ON public.member_subscriptions;
CREATE POLICY "Admins can view all subscriptions" ON public.member_subscriptions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
