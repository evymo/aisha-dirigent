-- Catalog is publicly readable (no sensitive content; just test names).
-- Writes are admin-only (catalog is seeded via migration).
DROP POLICY IF EXISTS aitg_test_catalog_read ON public.aitg_test_catalog;
CREATE POLICY aitg_test_catalog_read ON public.aitg_test_catalog
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS aitg_test_catalog_write_admin ON public.aitg_test_catalog;
CREATE POLICY aitg_test_catalog_write_admin ON public.aitg_test_catalog
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
