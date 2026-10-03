-- Function: public.apply_as_study_consultant_full
-- Arguments: p_study_id uuid, p_partner_id uuid, p_role text, p_max_participants integer, p_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:52+01:00

CREATE OR REPLACE FUNCTION public.apply_as_study_consultant_full(p_study_id uuid, p_partner_id uuid, p_role text DEFAULT 'consultant'::text, p_max_participants integer DEFAULT NULL::integer, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_consultant_id uuid;
  v_partner_user_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Verify the partner belongs to the current user
  SELECT user_id INTO v_partner_user_id
  FROM partner_profiles
  WHERE id = p_partner_id;
  
  IF v_partner_user_id IS NULL OR v_partner_user_id != v_user_id THEN
    RAISE EXCEPTION 'Unauthorized: Partner profile does not belong to current user';
  END IF;
  
  -- Check if application already exists
  SELECT id INTO v_consultant_id
  FROM study_consultants
  WHERE study_id = p_study_id AND partner_id = p_partner_id;
  
  IF v_consultant_id IS NOT NULL THEN
    -- Update existing application
    UPDATE study_consultants
    SET notes = COALESCE(p_notes, notes),
        max_participants = COALESCE(p_max_participants, max_participants),
        updated_at = NOW()
    WHERE id = v_consultant_id;
  ELSE
    -- Insert new application
    INSERT INTO study_consultants (study_id, partner_id, role, max_participants, notes, status)
    VALUES (p_study_id, p_partner_id, p_role::consultant_role_enum, p_max_participants, p_notes, 'pending')
    RETURNING id INTO v_consultant_id;
  END IF;
  
  RETURN v_consultant_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.apply_as_study_consultant_full(p_study_id uuid, p_partner_id uuid, p_role text, p_max_participants integer, p_notes text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_as_study_consultant_full(p_study_id uuid, p_partner_id uuid, p_role text, p_max_participants integer, p_notes text) TO authenticated;
