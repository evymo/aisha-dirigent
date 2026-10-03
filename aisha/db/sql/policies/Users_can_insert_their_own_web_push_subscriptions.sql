-- Policy: Users can insert their own web push subscriptions

CREATE POLICY "Users can insert their own web push subscriptions" ON public.web_push_subscriptions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((auth.uid() = user_id));
