-- Index: idx_hub_attr_entity

CREATE INDEX IF NOT EXISTS idx_hub_attr_entity ON public.hub_attribute_source (entity_type, entity_key, attribute);
