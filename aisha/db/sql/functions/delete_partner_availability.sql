-- Function: public.delete_partner_availability
-- Arguments: p_availability_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:23+01:00

CREATE OR REPLACE FUNCTION public.delete_partner_availability(p_availability_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  -- Verify user owns the partner profile linked to this availability
  SELECT pp.user_id INTO v_user_id
  FROM partner_availability pa
  JOIN partner_profiles pp ON pp.id = pa.partner_id
  WHERE pa.id = p_availability_id;
  
  IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to delete this availability';
  END IF;
  
  DELETE FROM partner_availability WHERE id = p_availability_id;
  
  RETURN true;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.delete_partner_availability(p_availability_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_partner_availability(p_availability_id uuid) TO authenticated;
