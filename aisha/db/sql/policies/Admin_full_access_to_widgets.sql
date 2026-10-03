-- Policy: Admin full access to widgets

DROP POLICY IF EXISTS "Admin full access to widgets" ON public.member_dashboard_widgets;
CREATE POLICY "Admin full access to widgets" ON public.member_dashboard_widgets
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))))
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));
