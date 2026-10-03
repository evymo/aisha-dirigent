-- Policy: service_role plný přístup (zápisy výhradně přes audited li_upsert_* RPC).

DROP POLICY IF EXISTS li_entity_suggestions_service_all ON public.li_entity_suggestions;
CREATE POLICY li_entity_suggestions_service_all ON public.li_entity_suggestions
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
