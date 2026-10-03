-- Grants: story_matrix_rooms

GRANT SELECT ON public.story_matrix_rooms TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.story_matrix_rooms TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.story_matrix_rooms TO service_role;
