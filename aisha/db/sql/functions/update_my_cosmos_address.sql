-- Function: update_my_cosmos_address
-- User RPC: allows authenticated user to set their own Cosmos wallet address.
-- Validates bech32 prefix (cosmos1...) and length. The prefix MUST match the
-- deployed node: it is stock ghcr.io/cosmos/simapp (see Dockerfile.cosmos), whose
-- compiled-in bech32 prefix is 'cosmos', so every address on that chain is cosmos1… .

CREATE OR REPLACE FUNCTION public.update_my_cosmos_address(
  p_cosmos_address text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'public'
AS $function$
BEGIN
  -- Validate bech32 format (cosmos1 prefix, 39-59 chars)
  IF p_cosmos_address IS NOT NULL
     AND (length(p_cosmos_address) < 39
          OR length(p_cosmos_address) > 59
          OR p_cosmos_address !~ '^cosmos1[a-z0-9]+$')
  THEN
    RAISE EXCEPTION 'Invalid Cosmos address format. Must start with cosmos1.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE profiles
  SET
    cosmos_address = p_cosmos_address,
    updated_at = now()
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'blockchain'::journal_area,
    p_details := jsonb_build_object('cosmos_address_updated', true),
    p_entity_id := auth.uid()::text,
    p_entity_type := 'profile',
    p_severity := 'info'::journal_severity,
    p_summary := 'Cosmos address updated',
    p_user_id := auth.uid()
  );
END;
$function$;

REVOKE ALL ON FUNCTION update_my_cosmos_address(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_my_cosmos_address(text) TO authenticated;
