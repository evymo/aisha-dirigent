-- Function: public.get_production_token_stats
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:23+01:00

CREATE OR REPLACE FUNCTION public.get_production_token_stats()
 RETURNS TABLE(event_type text, amount numeric, reference_volume numeric, loss_volume numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Access denied - admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    pte.event_type,
    pte.amount,
    pte.reference_volume,
    pte.loss_volume
  FROM production_token_events pte
  ORDER BY pte.event_type;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_token_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_token_stats() TO authenticated;
