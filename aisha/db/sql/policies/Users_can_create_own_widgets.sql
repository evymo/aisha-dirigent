-- Policy: Users can create own widgets

CREATE POLICY "Users can create own widgets" ON public.member_dashboard_widgets
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((user_id = auth.uid()));
