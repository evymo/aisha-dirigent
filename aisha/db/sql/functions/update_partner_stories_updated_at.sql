-- Function: public.update_partner_stories_updated_at
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:23+01:00

CREATE OR REPLACE FUNCTION public.update_partner_stories_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_partner_stories_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_partner_stories_updated_at() TO authenticated;
