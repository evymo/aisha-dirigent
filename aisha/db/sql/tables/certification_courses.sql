-- Table: certification_courses
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS certification_courses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL,
  description text,
  course_type text,
  duration_minutes int4,
  passing_score int4 DEFAULT 80,
  is_required bool DEFAULT false,
  is_active bool DEFAULT true,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT certification_courses_slug_key UNIQUE (slug)
);

ALTER TABLE certification_courses ENABLE ROW LEVEL SECURITY;
