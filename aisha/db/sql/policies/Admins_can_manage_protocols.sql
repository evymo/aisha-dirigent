-- Policy: Admins can manage protocols

DROP POLICY IF EXISTS "Admins can manage protocols" ON public.control_protocols;
CREATE POLICY "Admins can manage protocols" ON public.control_protocols
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
