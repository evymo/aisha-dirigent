-- Index: idx_distribution_adjustments_token
-- Table: distribution_adjustments

CREATE INDEX idx_distribution_adjustments_token ON public.distribution_adjustments USING btree (member_token);
