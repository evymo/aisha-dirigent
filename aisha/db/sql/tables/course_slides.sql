-- Table: course_slides
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS course_slides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  slide_order int4 NOT NULL,
  title text,
  content text,
  image_url text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT course_slides_course_id_fkey FOREIGN KEY (course_id) REFERENCES certification_courses(id) ON DELETE CASCADE
);

ALTER TABLE course_slides ENABLE ROW LEVEL SECURITY;
