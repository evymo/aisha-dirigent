-- Index: idx_member_health_states_catalog_id
-- Table: member_health_states

CREATE INDEX IF NOT EXISTS idx_member_health_states_catalog_id ON public.member_health_states(catalog_id);
