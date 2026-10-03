-- Index: idx_distribution_adjustments_protocol_id
-- Table: distribution_adjustments

CREATE INDEX IF NOT EXISTS idx_distribution_adjustments_protocol_id ON public.distribution_adjustments(protocol_id);
