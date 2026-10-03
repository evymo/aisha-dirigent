-- Index: idx_production_protocol_steps_batch_id
-- Table: production_protocol_steps

CREATE INDEX IF NOT EXISTS idx_production_protocol_steps_batch_id ON public.production_protocol_steps(batch_id);
