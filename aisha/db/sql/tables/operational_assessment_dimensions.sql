-- Table: operational_assessment_dimensions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS operational_assessment_dimensions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL,
  dimension operational_dimension NOT NULL,
  raw_score numeric(4,2),
  normalized_score numeric(5,2),
  tag_count int4 DEFAULT 0,
  has_negative_indicators bool DEFAULT false,
  operational_flags text[] DEFAULT '{}'::text[],
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT operational_assessment_dimensions_assessment_id_dimension_key UNIQUE (assessment_id, dimension),
  CONSTRAINT operational_assessment_dimensions_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES operational_assessments(id) ON DELETE CASCADE
);

ALTER TABLE operational_assessment_dimensions ENABLE ROW LEVEL SECURITY;
