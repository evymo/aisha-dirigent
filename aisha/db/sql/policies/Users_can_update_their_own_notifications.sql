-- Policy: Users can update their own notifications

CREATE POLICY "Users can update their own notifications" ON public.notifications
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
