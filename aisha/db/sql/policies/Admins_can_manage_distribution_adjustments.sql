-- Policy: Admins can manage distribution adjustments

DROP POLICY IF EXISTS "Admins can manage distribution adjustments" ON public.distribution_adjustments;
CREATE POLICY "Admins can manage distribution adjustments" ON public.distribution_adjustments
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
