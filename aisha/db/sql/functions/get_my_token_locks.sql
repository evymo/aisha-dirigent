-- Function: public.get_my_token_locks
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:27:06+01:00

CREATE OR REPLACE FUNCTION public.get_my_token_locks()
 RETURNS TABLE(id uuid, token_type text, locked_amount numeric(20,8), lock_condition text, locked_at timestamptz, unlock_at timestamptz, unlocked_at timestamptz, reference_id uuid, reference_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT 
    tl.id,
    tl.token_type::TEXT,
    tl.locked_amount,
    tl.lock_condition,
    tl.locked_at,
    tl.unlock_at,
    tl.unlocked_at,
    tl.reference_id,
    tl.reference_type
  FROM token_locks tl
  WHERE tl.user_id = auth.uid()
  ORDER BY tl.locked_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_token_locks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_token_locks() TO authenticated;
