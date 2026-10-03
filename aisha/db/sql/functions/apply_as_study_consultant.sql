-- Function: public.apply_as_study_consultant
-- Arguments: p_study_id uuid, p_role text, p_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:51+01:00

CREATE OR REPLACE FUNCTION public.apply_as_study_consultant(p_study_id uuid, p_role text DEFAULT 'consultant'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id UUID;
  v_partner_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id INTO v_partner_id FROM partner_profiles WHERE user_id = v_user_id;
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Partner profile not found';
  END IF;

  INSERT INTO study_consultants (study_id, partner_id, role, notes, status)
  VALUES (p_study_id, v_partner_id, p_role, p_notes, 'pending')
  RETURNING row_to_json(study_consultants)::jsonb INTO v_result;

  RETURN v_result;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.apply_as_study_consultant(p_study_id uuid, p_role text, p_notes text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_as_study_consultant(p_study_id uuid, p_role text, p_notes text) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_as_study_consultant(p_study_id uuid, p_role text, p_notes text) TO authenticated;
