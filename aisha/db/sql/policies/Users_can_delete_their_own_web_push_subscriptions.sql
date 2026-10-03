-- Policy: Users can delete their own web push subscriptions

CREATE POLICY "Users can delete their own web push subscriptions" ON public.web_push_subscriptions
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((auth.uid() = user_id));
