-- Function: public.get_my_partner_certification
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:00+01:00

CREATE OR REPLACE FUNCTION public.get_my_partner_certification()
 RETURNS SETOF partner_certifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    pc.id,
    pc.partner_id,
    pc.certification_type,
    pc.issued_at,
    pc.expires_at,
    pc.certificate_url,
    pc.created_at,
    pc.user_id,
    pc.score,
    pc.passed,
    pc.answers,
    pc.completed_at
  FROM public.partner_certifications pc
  WHERE pc.user_id = auth.uid()
  ORDER BY pc.created_at DESC LIMIT 1;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_partner_certification() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_partner_certification() TO authenticated;
