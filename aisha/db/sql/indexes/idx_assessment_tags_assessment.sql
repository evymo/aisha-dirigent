-- Index: idx_assessment_tags_assessment
-- Table: operational_assessment_tags

CREATE INDEX idx_assessment_tags_assessment ON public.operational_assessment_tags USING btree (assessment_id);
