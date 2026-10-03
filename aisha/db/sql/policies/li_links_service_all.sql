-- Policy: service_role plný přístup (zápisy výhradně přes audited li_upsert_* RPC).

DROP POLICY IF EXISTS li_links_service_all ON public.li_links;
CREATE POLICY li_links_service_all ON public.li_links
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
