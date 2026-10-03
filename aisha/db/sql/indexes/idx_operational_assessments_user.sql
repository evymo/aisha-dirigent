-- Index: idx_operational_assessments_user
-- Table: operational_assessments

CREATE INDEX idx_operational_assessments_user ON public.operational_assessments USING btree (user_id);
