-- Function: audience_study_consultants_default_scope

CREATE OR REPLACE FUNCTION public.audience_study_consultants_default_scope()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.scope_type IS NULL THEN
    NEW.scope_type := 'study';
  END IF;
  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_study_consultants_default_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_study_consultants_default_scope() TO authenticated;
GRANT EXECUTE ON FUNCTION audience_study_consultants_default_scope() TO service_role;
