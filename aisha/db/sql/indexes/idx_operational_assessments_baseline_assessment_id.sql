-- Index: idx_operational_assessments_baseline_assessment_id
-- Table: operational_assessments

CREATE INDEX IF NOT EXISTS idx_operational_assessments_baseline_assessment_id ON public.operational_assessments(baseline_assessment_id);
