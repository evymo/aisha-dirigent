-- Policy: Admins can manage protocol steps

DROP POLICY IF EXISTS "Admins can manage protocol steps" ON public.production_protocol_steps;
CREATE POLICY "Admins can manage protocol steps" ON public.production_protocol_steps
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
