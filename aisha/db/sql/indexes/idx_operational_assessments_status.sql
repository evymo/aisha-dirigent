-- Index: idx_operational_assessments_status
-- Table: operational_assessments

CREATE INDEX idx_operational_assessments_status ON public.operational_assessments USING btree (status);
