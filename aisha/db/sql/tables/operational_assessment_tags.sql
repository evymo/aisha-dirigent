-- Table: operational_assessment_tags
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS operational_assessment_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL,
  tag_id text NOT NULL,
  dimension operational_dimension NOT NULL,
  category text NOT NULL,
  tag_score numeric(4,2),
  inverse_score bool DEFAULT false,
  is_followup bool DEFAULT false,
  parent_tag_id text,
  selected_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT operational_assessment_tags_assessment_id_tag_id_key UNIQUE (tag_id, assessment_id),
  CONSTRAINT operational_assessment_tags_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES operational_assessments(id) ON DELETE CASCADE
);

ALTER TABLE operational_assessment_tags ENABLE ROW LEVEL SECURITY;
