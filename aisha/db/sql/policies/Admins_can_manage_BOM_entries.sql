-- Policy: Admins can manage BOM entries

DROP POLICY IF EXISTS "Admins can manage BOM entries" ON public.production_bom_entries;
CREATE POLICY "Admins can manage BOM entries" ON public.production_bom_entries
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
