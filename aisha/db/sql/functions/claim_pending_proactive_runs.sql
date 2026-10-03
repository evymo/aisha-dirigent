-- Function: claim_pending_proactive_runs
-- DOHNÁNÍ executoru akcí po události. `pg_notify('ai_proactive_dispatch')` je jen
-- budík: notify vydaný, když executor neběžel (nasazení, pád spojení), se ztratí.
-- Běh ale v `ai_proactive_runs` zůstal jako `pending` — outbox vzniká v transakci
-- se zdrojovým zápisem — a tahle funkce ho při pravidelném tiku i po startu vezme.
--
-- `p_min_age_seconds` dává přednost notify: čerstvý běh zabere cesta přes notify,
-- dohnání bere jen to, co zjevně zůstalo ležet. `FOR UPDATE … SKIP LOCKED` → dva
-- executory si dávku nerozdělí dvakrát.
--
-- Vrací pole { run, definition } (tvar jako claim_proactive_run), nejstarší napřed.

CREATE OR REPLACE FUNCTION public.claim_pending_proactive_runs(
  p_worker          text,
  p_channels        text[],
  p_limit           integer DEFAULT 20,
  p_min_age_seconds integer DEFAULT 5
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  WITH k AS (
    SELECT r.id
      FROM ai_proactive_runs r
      JOIN ai_proactive_trigger_definitions d ON d.id = r.trigger_definition_id
     WHERE r.status = 'pending'
       AND r.created_at < now() - make_interval(secs => greatest(coalesce(p_min_age_seconds, 0), 0))
       AND (d.action_config ->> 'channel') = ANY (p_channels)
     ORDER BY r.created_at
     LIMIT least(greatest(coalesce(p_limit, 20), 1), 200)
     FOR UPDATE OF r SKIP LOCKED
  ), u AS (
    UPDATE ai_proactive_runs r
       SET status     = 'running',
           started_at = now(),
           metadata   = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
                          'worker',     p_worker,
                          'claimed_at', now(),
                          'attempts',   coalesce((r.metadata ->> 'attempts')::int, 0) + 1,
                          'via',        'catchup')
      FROM k, ai_proactive_trigger_definitions d
     WHERE r.id = k.id
       AND d.id = r.trigger_definition_id
    RETURNING r.created_at, jsonb_build_object(
      'run', jsonb_build_object(
        'id',               r.id,
        'user_id',          r.user_id,
        'source_record_id', r.source_record_id,
        'source_data',      r.source_data,
        'metadata',         r.metadata,
        'created_at',       r.created_at),
      'definition', jsonb_build_object(
        'id',            d.id,
        'name',          d.name,
        'action_type',   d.action_type,
        'source_table',  d.source_table,
        'source_event',  d.source_event,
        'action_config', d.action_config)) AS item
  )
  SELECT coalesce(jsonb_agg(u.item ORDER BY u.created_at), '[]'::jsonb) INTO v_out FROM u;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pending_proactive_runs(text, text[], integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_proactive_runs(text, text[], integer, integer) TO service_role;
