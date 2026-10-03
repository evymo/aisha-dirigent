-- Policy: Admins can manage distribution protocols

DROP POLICY IF EXISTS "Admins can manage distribution protocols" ON public.distribution_protocols;
CREATE POLICY "Admins can manage distribution protocols" ON public.distribution_protocols
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
