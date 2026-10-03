-- Function: public.set_questionnaire_response_version
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:06+01:00

CREATE OR REPLACE FUNCTION public.set_questionnaire_response_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.questionnaire_version IS NULL THEN
    SELECT q.version INTO NEW.questionnaire_version
    FROM public.questionnaires q
    WHERE q.id = NEW.questionnaire_id;
  END IF;

  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.set_questionnaire_response_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_questionnaire_response_version() TO authenticated;
