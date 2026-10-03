-- Function: audience_study_consultants_validate_scope_fk

CREATE OR REPLACE FUNCTION public.audience_study_consultants_validate_scope_fk()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.scope_type = 'study' THEN
    IF NOT EXISTS (SELECT 1 FROM public.studies WHERE id = NEW.study_id) THEN
      RAISE EXCEPTION 'study_id % does not reference an existing study (scope_type=study)', NEW.study_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_study_consultants_validate_scope_fk() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_study_consultants_validate_scope_fk() TO authenticated;
GRANT EXECUTE ON FUNCTION audience_study_consultants_validate_scope_fk() TO service_role;
