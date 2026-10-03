-- Policy: Users can update own widgets

CREATE POLICY "Users can update own widgets" ON public.member_dashboard_widgets
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
