-- Policy: Admins can manage equipment

DROP POLICY IF EXISTS "Admins can manage equipment" ON public.production_equipment;
CREATE POLICY "Admins can manage equipment" ON public.production_equipment
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
