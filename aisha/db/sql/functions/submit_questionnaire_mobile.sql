-- Function: public.submit_questionnaire_mobile
-- Arguments: p_questionnaire_id uuid, p_study_registration_id uuid, p_responses jsonb
-- Description: Mobile wrapper for submit_questionnaire_response (scheduling + rewards)
-- Security: SECURITY DEFINER

CREATE OR REPLACE FUNCTION public.submit_questionnaire_mobile(
  p_questionnaire_id uuid,
  p_study_registration_id uuid,
  p_responses jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.submit_questionnaire_response(
    p_questionnaire_id,
    p_responses,
    p_study_registration_id
  );
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.submit_questionnaire_mobile(p_questionnaire_id uuid, p_study_registration_id uuid, p_responses jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_questionnaire_mobile(p_questionnaire_id uuid, p_study_registration_id uuid, p_responses jsonb) TO authenticated;
