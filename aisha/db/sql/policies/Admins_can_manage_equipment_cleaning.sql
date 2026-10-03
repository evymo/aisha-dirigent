-- Policy: Admins can manage equipment cleaning

DROP POLICY IF EXISTS "Admins can manage equipment cleaning" ON public.production_equipment_cleaning;
CREATE POLICY "Admins can manage equipment cleaning" ON public.production_equipment_cleaning
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
