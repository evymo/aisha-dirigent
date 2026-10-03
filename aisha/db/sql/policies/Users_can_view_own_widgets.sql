-- Policy: Users can view own widgets

CREATE POLICY "Users can view own widgets" ON public.member_dashboard_widgets
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));
