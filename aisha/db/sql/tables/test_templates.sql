-- Table: test_templates
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS test_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid,
  title text NOT NULL,
  description text,
  time_limit_minutes int4,
  passing_score int4 DEFAULT 80,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT test_templates_course_id_fkey FOREIGN KEY (course_id) REFERENCES certification_courses(id) ON DELETE SET NULL
);

ALTER TABLE test_templates ENABLE ROW LEVEL SECURITY;
