-- Index: idx_course_slides_course_id
-- Table: course_slides

CREATE INDEX IF NOT EXISTS idx_course_slides_course_id ON public.course_slides(course_id);
