-- Function: public.resolve_security_pattern
-- Arguments: p_pattern_id uuid, p_notes text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:01+01:00

CREATE OR REPLACE FUNCTION public.resolve_security_pattern(p_pattern_id uuid, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO security_event_resolutions (audit_event_id, resolved_at, resolved_by, resolution_notes)
  VALUES (p_pattern_id, now(), auth.uid(), p_notes)
  ON CONFLICT (audit_event_id) DO UPDATE SET
    resolved_at = now(),
    resolved_by = auth.uid(),
    resolution_notes = p_notes;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.resolve_security_pattern(p_pattern_id uuid, p_notes text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_security_pattern(p_pattern_id uuid, p_notes text) TO authenticated;
