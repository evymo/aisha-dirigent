-- Policy: Users can view their own web push subscriptions

CREATE POLICY "Users can view their own web push subscriptions" ON public.web_push_subscriptions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
