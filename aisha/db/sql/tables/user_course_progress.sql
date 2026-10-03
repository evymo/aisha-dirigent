-- Table: user_course_progress
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS user_course_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  course_id uuid NOT NULL,
  current_slide int4 DEFAULT 0,
  completed bool DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT user_course_progress_user_id_course_id_key UNIQUE (course_id, user_id),
  CONSTRAINT user_course_progress_course_id_fkey FOREIGN KEY (course_id) REFERENCES certification_courses(id) ON DELETE CASCADE,
  CONSTRAINT user_course_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE user_course_progress ENABLE ROW LEVEL SECURITY;
