-- Policy: Admins can view all web push subscriptions

DROP POLICY IF EXISTS "Admins can view all web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Admins can view all web push subscriptions" ON public.web_push_subscriptions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
