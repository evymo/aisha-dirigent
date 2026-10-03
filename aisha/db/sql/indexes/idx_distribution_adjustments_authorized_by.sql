-- Index: idx_distribution_adjustments_authorized_by
-- Table: distribution_adjustments

CREATE INDEX IF NOT EXISTS idx_distribution_adjustments_authorized_by ON public.distribution_adjustments(authorized_by);
