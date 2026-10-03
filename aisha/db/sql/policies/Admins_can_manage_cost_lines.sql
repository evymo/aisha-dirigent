-- Policy: Admins can manage cost lines

DROP POLICY IF EXISTS "Admins can manage cost lines" ON public.production_cost_lines;
CREATE POLICY "Admins can manage cost lines" ON public.production_cost_lines
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
