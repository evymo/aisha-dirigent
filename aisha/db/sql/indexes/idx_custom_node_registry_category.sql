-- Index: idx_custom_node_registry_category
-- Table: custom_node_registry

CREATE INDEX IF NOT EXISTS idx_custom_node_registry_category
  ON public.custom_node_registry (category);
