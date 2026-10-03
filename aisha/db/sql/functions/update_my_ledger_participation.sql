-- Function: update_my_ledger_participation
-- User RPC (D2): lets an authenticated member set their OWN ledger_participation —
-- whether their activity is anchored to the personal Cosmos chain (layer 2). The
-- in-DB hash-chain book (layer 1) is unaffected. Self-scoped via auth.uid(),
-- mirroring update_my_cosmos_address.sql.
--
-- Preservation (D2): the row-ensuring INSERT uses ON CONFLICT DO NOTHING (it never
-- clobbers an existing choice — a re-apply is a no-op); the member's explicit new
-- value is applied by the subsequent self-scoped UPDATE.

CREATE OR REPLACE FUNCTION public.update_my_ledger_participation(
  p_participates boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_participates IS NULL THEN
    RAISE EXCEPTION 'ledger_participation value is required' USING ERRCODE = 'check_violation';
  END IF;

  -- Ensure the member's row exists WITHOUT overwriting an existing choice.
  INSERT INTO public.ledger_participation (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO NOTHING;

  -- Apply THIS member's explicit choice (self-scoped; not a migration re-apply).
  UPDATE public.ledger_participation
     SET participates = p_participates,
         updated_at = now()
   WHERE user_id = auth.uid();

  PERFORM public.write_audit_journal(
    p_action_type := 'update'::journal_action_type,
    p_area := 'blockchain'::journal_area,
    p_details := jsonb_build_object('ledger_participation', p_participates),
    p_entity_id := auth.uid()::text,
    p_entity_type := 'ledger_participation',
    p_severity := 'info'::journal_severity,
    p_summary := 'Ledger participation updated',
    p_user_id := auth.uid()
  );
END;
$function$;

COMMENT ON FUNCTION public.update_my_ledger_participation(boolean) IS
  'Self-service D2 opt-out: a member sets their own on-chain anchoring participation '
  '(layer 2). The in-DB book (layer 1) is never gated. Preserve-on-conflict seed.';

REVOKE ALL ON FUNCTION update_my_ledger_participation(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_my_ledger_participation(boolean) TO authenticated;
