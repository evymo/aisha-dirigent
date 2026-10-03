-- Index: idx_assessment_tags_dimension
-- Table: operational_assessment_tags

CREATE INDEX idx_assessment_tags_dimension ON public.operational_assessment_tags USING btree (dimension);
