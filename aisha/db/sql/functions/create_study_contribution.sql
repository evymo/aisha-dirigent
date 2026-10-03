-- Function: public.create_study_contribution
-- Arguments: p_study_id uuid, p_contribution_type text, p_amount numeric, p_currency text, p_message text, p_is_anonymous boolean
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:15+01:00

CREATE OR REPLACE FUNCTION public.create_study_contribution(p_study_id uuid, p_contribution_type text, p_amount numeric, p_currency text DEFAULT public.commerce_base_currency(), p_message text DEFAULT NULL::text, p_is_anonymous boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_contribution_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  INSERT INTO study_contributions (
    study_id,
    user_id,
    contribution_type,
    amount,
    currency,
    message,
    is_anonymous,
    status
  ) VALUES (
    p_study_id,
    v_user_id,
    p_contribution_type::contribution_type_enum,
    p_amount,
    p_currency,
    p_message,
    p_is_anonymous,
    'pending'
  )
  RETURNING id INTO v_contribution_id;
  
  RETURN v_contribution_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_study_contribution(p_study_id uuid, p_contribution_type text, p_amount numeric, p_currency text, p_message text, p_is_anonymous boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_study_contribution(p_study_id uuid, p_contribution_type text, p_amount numeric, p_currency text, p_message text, p_is_anonymous boolean) TO authenticated;
