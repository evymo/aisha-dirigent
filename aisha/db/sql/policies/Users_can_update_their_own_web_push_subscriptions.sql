-- Policy: Users can update their own web push subscriptions

CREATE POLICY "Users can update their own web push subscriptions" ON public.web_push_subscriptions
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
