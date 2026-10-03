-- Index: idx_distribution_adjustments_active
-- Table: distribution_adjustments

CREATE INDEX idx_distribution_adjustments_active ON public.distribution_adjustments USING btree (is_active) WHERE (is_active = true);
