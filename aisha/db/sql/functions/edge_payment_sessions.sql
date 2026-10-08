-- Function: public.edge_payment_sessions
-- Purpose: Edge-safe payment session writes.
--   služba (svc-stripe webhook / subscription-checkout, rpcService): insert, update_status
--   přihlášený za SEBE (svc-stripe checkout, rpcUser):               insert s user_id = auth.uid()

CREATE OR REPLACE FUNCTION public.edge_payment_sessions(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  -- ⛔ NÁROK PŘED DISPEČEREM, VÝCHOZÍ ODMÍTNUTÍ (nález 2026-10-06, táž třída jako
  -- edge_bank_transactions). SECURITY DEFINER s GRANT pro authenticated a bez stráže:
  -- kdokoli přihlášený přepsal stav CIZÍ platební relace (update_status podle
  -- stripe_session_id, třeba na 'completed') a zakládal relace za cizí účty.
  -- Člen smí jen to, co mu dovoluje RLS policy „Users can create own payment
  -- sessions“: vložit relaci za SEBE. Každá jiná akce je práce služby.
  -- `IS NOT TRUE`, ne `NOT (…)`: NULL nesmí stráž přeskočit.
  IF p_action IS DISTINCT FROM 'insert' AND public.is_service_role() IS NOT TRUE THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'insert' AND public.is_service_role() IS NOT TRUE
     AND (NULLIF(p_payload ->> 'user_id', '')::uuid = auth.uid()) IS NOT TRUE THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'insert' THEN
    INSERT INTO public.payment_sessions (
      amount,
      currency,
      expires_at,
      metadata,
      reference_id,
      reference_type,
      session_type,
      status,
      stripe_session_id,
      user_id
    )
    VALUES (
      NULLIF(p_payload ->> 'amount', '')::numeric,
      COALESCE(NULLIF(p_payload ->> 'currency', ''), public.commerce_base_currency()),
      NULLIF(p_payload ->> 'expires_at', '')::timestamptz,
      COALESCE(p_payload -> 'metadata', '{}'::jsonb),
      NULLIF(p_payload ->> 'reference_id', '')::uuid,
      NULLIF(p_payload ->> 'reference_type', ''),
      NULLIF(p_payload ->> 'session_type', ''),
      COALESCE(NULLIF(p_payload ->> 'status', ''), 'pending'),
      NULLIF(p_payload ->> 'stripe_session_id', ''),
      NULLIF(p_payload ->> 'user_id', '')::uuid
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'ok', true);
  END IF;

  IF p_action = 'update_status' THEN
    UPDATE public.payment_sessions
    SET
      completed_at = CASE WHEN p_payload ? 'completed_at' THEN NULLIF(p_payload ->> 'completed_at', '')::timestamptz ELSE completed_at END,
      status = COALESCE(NULLIF(p_payload ->> 'status', ''), status),
      updated_at = now()
    WHERE stripe_session_id = NULLIF(p_payload ->> 'stripe_session_id', '');

    RETURN jsonb_build_object('ok', true, 'updated', FOUND);
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_payment_sessions(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_payment_sessions(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_payment_sessions(text, jsonb) TO authenticated;
