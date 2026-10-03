-- Function: set_updated_at

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;
