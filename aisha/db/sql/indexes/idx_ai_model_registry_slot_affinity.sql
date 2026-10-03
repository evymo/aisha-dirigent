-- Index: idx_ai_model_registry_slot_affinity
-- Auto-extracted (back-port reconciliation)

CREATE INDEX IF NOT EXISTS idx_ai_model_registry_slot_affinity ON public.ai_model_registry USING gin (slot_affinity);
