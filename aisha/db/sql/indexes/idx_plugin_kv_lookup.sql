-- Index: idx_plugin_kv_lookup

CREATE INDEX IF NOT EXISTS idx_plugin_kv_lookup ON public.plugin_kv USING btree (plugin_id, tenant_id, key);
