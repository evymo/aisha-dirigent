GRANT SELECT ON public.source_catalog_rows TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.source_catalog_rows TO service_role;
