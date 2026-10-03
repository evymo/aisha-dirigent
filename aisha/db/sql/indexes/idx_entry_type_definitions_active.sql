-- Index: idx_entry_type_definitions_active
-- Active entry-type lookup ordered by sort_order for the type registry.

CREATE INDEX idx_entry_type_definitions_active ON entry_type_definitions (is_active, sort_order);
