-- Policy: Users can view their own subscriptions

CREATE POLICY "Users can view their own subscriptions" ON public.member_subscriptions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((user_id = auth.uid()));
