-- Function: public.get_retryable_integration_events
-- Returns failed integration events whose next_retry_at has passed.
-- Used by WF_RETRY_FAILED_EVENTS n8n workflow for exponential backoff retry.
-- @security: service_role only (called from n8n with service_role key)

-- ⛔ ZDROJE VYJMENUJE VOLAJÍCÍ (revize integrátora 2026-10-05, příjem pošty): dřív funkce vracela
-- KAŽDÝ failed event a WF_RETRY_FAILED_EVENTS ho poslal do github-webhook-bridge bez ohledu na
-- event_source — e-mail s chybou skenu (nebo jakýkoli další nový zdroj) by šel do GitHub mostu.
-- Volající proto jmenuje zdroje, které jeho opakování UMÍ; neznámý zdroj se nevrátí nikdy
-- (fail-closed). Prázdný nebo chybějící seznam = výjimka, ne „všechno“.
-- Stará signatura (jen p_limit) by vracela vše → pryč.
DROP FUNCTION IF EXISTS public.get_retryable_integration_events(integer);

CREATE OR REPLACE FUNCTION public.get_retryable_integration_events(
  p_sources text[],
  p_limit   integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
BEGIN
  -- Jen role služby i uvnitř (dřív ji držely jen granty — fork s výchozím EXECUTE pro
  -- authenticated by ji pustil komukoli přihlášenému).
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'get_retryable_integration_events: jen role služby' USING ERRCODE = '42501';
  END IF;
  IF p_sources IS NULL OR cardinality(p_sources) = 0 THEN
    RAISE EXCEPTION 'get_retryable_integration_events: p_sources je povinný — jmenuj zdroje, které tvoje opakování umí'
      USING ERRCODE = '22023';
  END IF;
  -- LIMIT uvnitř poddotazu: dřív stál za agregací (jeden řádek), takže p_limit nic neomezoval.
  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', ie.id,
        'event_source', ie.event_source,
        'external_id', ie.external_id,
        'event_type', ie.event_type,
        'installation_id', ie.installation_id,
        'story_id', ie.story_id,
        'partner_id', ie.partner_id,
        'routed_to', ie.routed_to,
        'attempt', ie.attempt,
        'max_attempts', ie.max_attempts,
        'payload_hash', ie.payload_hash,
        'error_json', ie.error_json,
        'created_at', ie.created_at
      )
      ORDER BY ie.next_retry_at ASC
    ), '[]'::jsonb)
    FROM (
      SELECT *
        FROM integration_events
       WHERE status = 'failed'
         AND event_source = ANY (p_sources)
         AND next_retry_at IS NOT NULL
         AND next_retry_at <= now()
         AND attempt < max_attempts
       ORDER BY next_retry_at ASC
       LIMIT p_limit
    ) ie
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_retryable_integration_events(text[], integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_retryable_integration_events(text[], integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_retryable_integration_events(text[], integer) TO service_role;
