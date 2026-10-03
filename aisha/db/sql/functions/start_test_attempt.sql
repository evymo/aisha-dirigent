-- Function: public.start_test_attempt
-- Arguments: p_template_id uuid
-- Description: Opens a System-B test attempt for the caller against a per-cohort test
--   template. Access is gated on enrollment: the caller must be enrolled in a study
--   that offers this template (study_test_templates). SECURITY DEFINER so attempt rows
--   are server-created — clients hold no write grant on test_attempts (see grants), so
--   a passing attempt cannot be forged.
-- Security: SECURITY DEFINER, authenticated only.

CREATE OR REPLACE FUNCTION public.start_test_attempt(p_template_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_active boolean;
  v_attempt_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_template_id IS NULL THEN
    RAISE EXCEPTION 'Missing template id';
  END IF;

  SELECT is_active INTO v_active FROM public.test_templates WHERE id = p_template_id;
  IF NOT FOUND OR NOT COALESCE(v_active, false) THEN
    RAISE EXCEPTION 'Test template not available';
  END IF;

  -- Per-cohort access: the caller must be enrolled in a study that offers this template.
  IF NOT EXISTS (
    SELECT 1
    FROM public.study_test_templates stt
    JOIN public.study_registrations sr ON sr.study_id = stt.study_id
    WHERE stt.template_id = p_template_id
      AND sr.user_id = v_user_id
      AND sr.status IN ('enrolled', 'active')
  ) THEN
    RAISE EXCEPTION 'Not enrolled in a study offering this test' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.test_attempts (user_id, template_id, started_at)
  VALUES (v_user_id, p_template_id, now())
  RETURNING id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.start_test_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_test_attempt(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_test_attempt(uuid) TO service_role;
