-- Function: get_questionnaire_id_by_code
-- Purpose: Simple lookup to resolve questionnaire UUID from its code
-- Access: authenticated
-- Security: SECURITY DEFINER (bypasses RLS, returns only ID)
-- @audit: none

CREATE OR REPLACE FUNCTION public.get_questionnaire_id_by_code(
  p_code text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT q.id INTO v_id
  FROM questionnaires q
  WHERE q.code = p_code
    AND q.is_active = true;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_questionnaire_id_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_questionnaire_id_by_code(text) TO authenticated;
