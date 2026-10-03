-- Policy: Admins can manage archive tags

DROP POLICY IF EXISTS "Admins can manage archive tags" ON public.archive_tags;
CREATE POLICY "Admins can manage archive tags" ON public.archive_tags
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
