-- Index: idx_custom_node_registry_active
-- Table: custom_node_registry

CREATE INDEX IF NOT EXISTS idx_custom_node_registry_active
  ON public.custom_node_registry (is_active) WHERE is_active = true;
