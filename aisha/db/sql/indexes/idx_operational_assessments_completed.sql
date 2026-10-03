-- Index: idx_operational_assessments_completed
-- Table: operational_assessments

CREATE INDEX idx_operational_assessments_completed ON public.operational_assessments USING btree (completed_at) WHERE (status = 'completed'::assessment_status);
