-- Policy: Users can view their own notifications

CREATE POLICY "Users can view their own notifications" ON public.notifications
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
