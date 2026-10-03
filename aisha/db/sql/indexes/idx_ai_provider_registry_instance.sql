-- Index: idx_ai_provider_registry_instance
-- §19.4 per-instance scoping: speeds the RLS predicate + resolver tenant-filter.

CREATE INDEX IF NOT EXISTS idx_ai_provider_registry_instance
  ON public.ai_provider_registry USING btree (scoped_to_instance_id);
