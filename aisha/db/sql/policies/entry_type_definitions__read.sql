-- Policy: entry_type_definitions_read / _service
-- The post-type catalog is non-sensitive UI metadata: any authenticated member
-- may READ the active types (so the composer can offer them). Writes are
-- service_role only (seeded by the stack + implementations, not by members).

CREATE POLICY "entry_type_definitions_read"
  ON public.entry_type_definitions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "entry_type_definitions_service"
  ON public.entry_type_definitions
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);
