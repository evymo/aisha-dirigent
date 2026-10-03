-- Function: public.get_production_token_events
-- Arguments: p_limit integer
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:23+01:00

CREATE OR REPLACE FUNCTION public.get_production_token_events(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, protocol_step_id uuid, batch_id uuid, event_type text, token_type text, amount numeric, reason text, description text, reference_volume numeric, loss_volume numeric, created_by uuid, created_at timestamptz, batch_code text, product_name text)
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
    pte.id,
    pte.protocol_step_id,
    pte.batch_id,
    pte.event_type,
    pte.token_type,
    pte.amount,
    pte.reason,
    pte.description,
    pte.reference_volume,
    pte.loss_volume,
    pte.created_by,
    pte.created_at,
    pb.batch_code,
    prod.name as product_name
  FROM production_token_events pte
  LEFT JOIN production_batches pb ON pb.id = pte.batch_id
  LEFT JOIN products prod ON prod.id = pb.product_id
  ORDER BY pte.created_at DESC
  LIMIT p_limit;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_production_token_events(p_limit integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_production_token_events(p_limit integer) TO authenticated;
