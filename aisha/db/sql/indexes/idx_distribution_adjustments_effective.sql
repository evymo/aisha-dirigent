-- Index: idx_distribution_adjustments_effective
-- Table: distribution_adjustments

CREATE INDEX idx_distribution_adjustments_effective ON public.distribution_adjustments USING btree (effective_from, effective_until);
