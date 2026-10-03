-- Index: idx_assessment_dimensions_dimension
-- Table: operational_assessment_dimensions

CREATE INDEX idx_assessment_dimensions_dimension ON public.operational_assessment_dimensions USING btree (dimension);
