-- Function: public.get_my_token_transactions
-- Arguments: p_limit integer
-- Description: Returns the authenticated user's token transactions (most recent first).
-- Security: SECURITY DEFINER — bypasses RLS, filters by auth.uid() explicitly.

CREATE OR REPLACE FUNCTION public.get_my_token_transactions(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, user_id uuid, token_type text, amount numeric, transaction_type text, description text, reference_id uuid, reference_type text, balance_after numeric, created_at timestamptz)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT tt.id, tt.user_id, tt.token_type::TEXT, tt.amount, tt.transaction_type::TEXT,
         tt.description, tt.reference_id, tt.reference_type, tt.balance_after, tt.created_at
  FROM public.token_transactions tt
  WHERE tt.user_id = v_user_id
  ORDER BY tt.created_at DESC
  LIMIT GREATEST(1, COALESCE(p_limit, 50));
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_token_transactions(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_token_transactions(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_token_transactions(integer) TO authenticated;
