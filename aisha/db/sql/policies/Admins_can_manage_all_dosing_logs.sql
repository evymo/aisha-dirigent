-- Policy: Admins can manage all dosing logs

DROP POLICY IF EXISTS "Admins can manage all dosing logs" ON public.dosing_logs;
CREATE POLICY "Admins can manage all dosing logs" ON public.dosing_logs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
