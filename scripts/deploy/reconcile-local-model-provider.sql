-- reconcile-local-model-provider.sql — provider `vllm-local` je ODVOZENÝ z topologie.
--
-- Spouští docker-migrate-entrypoint.sh po úspěšném migrate + seed:
--     psql "$DB_URL" -v ON_ERROR_STOP=1 -v ep="${VLLM_GENERATION_URL:-}" -f scripts/deploy/reconcile-local-model-provider.sql
-- Týž soubor pouští runtime test proti čisté DB (src/tests/db/lokalni-model-provider-runtime.test.ts),
-- takže testovaná a nasazená logika jsou jedna a táž.
--
-- ⛔ NAMĚŘENO 2026-09-13: seed (aisha/db/seed/core/19_ai_provider_catalog.sql) zakládá
-- `vllm-local` VYPNUTÝ s adresou `http://vllm:8000` — aliasem, který v žádné instanci
-- neexistuje — a NIC ho nezapínalo ani nepřesměrovalo na svc-model. Lokální model
-- běžel, discovery ho mohla vidět, ale resolver (aisha_resolve_clow_backend,
-- fn_resolve_embedding_model_for_space) ho nikdy nevybral: provider byl vypnutý.
--
-- Pravda o tom, jestli instance lokální model MÁ, je jediná: resolver topologie vydá
-- VLLM_GENERATION_URL jen pro provisionovaný svc-model (config/services.json →
-- model.provision_when_env: CHAT_GGUF_URL). Stejný tvar jako reconcile llm-gateway
-- o pár řádků výš v entrypointu, jen dotažený do konce — i vypnutí je odvozené:
--   · adresa je  → provider povolen, endpoint = odvozená adresa, health_url = <adresa>/models
--                  (sonda WF_PROVIDER_HEALTH_PROBE by jinak lepila /v1/models za /v1);
--   · adresa není → provider VYPNUTÝ, hlasitě (NOTICE do logu migrate + audit při změně).
-- Změna adresy = jiný server: modely providera se vedou jako nedostupné, dokud je
-- discovery svc-ai-chat neuvidí v jeho živém listingu (a nezměří jejich rozměr).
--
-- Idempotentní: beze změny stavu nic nezapisuje (ani audit).

\set ON_ERROR_STOP on
BEGIN;

-- psql proměnná se do DO bloku (dollar-quoted) neinterpoluje — předává se přes GUC transakce.
SELECT set_config('aisha.local_model_endpoint', :'ep', true);

DO $reconcile$
DECLARE
  v_endpoint text := NULLIF(btrim(current_setting('aisha.local_model_endpoint', true)), '');
  v_row public.ai_provider_registry%ROWTYPE;
  v_models_reset integer := 0;
BEGIN
  SELECT * INTO v_row FROM public.ai_provider_registry WHERE slug = 'vllm-local' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_provider_registry nemá řádek vllm-local — katalog providerů (seed 19_ai_provider_catalog) neproběhl';
  END IF;

  IF v_endpoint IS NULL THEN
    IF v_row.is_enabled THEN
      UPDATE public.ai_provider_registry
         SET is_enabled = false, updated_at = now()
       WHERE id = v_row.id;
      INSERT INTO public.audit_journal (user_id, action, metadata)
      VALUES (NULL, 'local_model_provider_reconciled', jsonb_build_object(
        'slug', 'vllm-local', 'is_enabled', false, 'reason', 'no_derived_endpoint',
        'previous_endpoint', v_row.endpoint_url));
    END IF;
    RAISE NOTICE 'vllm-local VYPNUTÝ: VLLM_GENERATION_URL není odvozená — svc-model v téhle instanci není provisionovaný (CHAT_GGUF_URL prázdné), lokální model resolver nenabídne.';
    RETURN;
  END IF;

  -- Jen tvar adresy; KAM smí mířit, rozhoduje topologie, ne tenhle skript.
  IF v_endpoint !~ '^https?://[^/[:space:]]+' THEN
    RAISE EXCEPTION 'VLLM_GENERATION_URL není http(s) adresa: %', v_endpoint;
  END IF;

  IF v_row.endpoint_url IS DISTINCT FROM v_endpoint THEN
    UPDATE public.ai_model_registry
       SET is_available = false
     WHERE (provider_registry_id = v_row.id OR provider = 'vllm')
       AND is_available;
    GET DIAGNOSTICS v_models_reset = ROW_COUNT;
  END IF;

  IF v_row.endpoint_url IS DISTINCT FROM v_endpoint OR NOT v_row.is_enabled THEN
    UPDATE public.ai_provider_registry
       SET endpoint_url       = v_endpoint,
           health_url         = rtrim(v_endpoint, '/') || '/models',
           is_enabled         = true,
           last_health_status = 'unknown',
           updated_at         = now()
     WHERE id = v_row.id;
    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (NULL, 'local_model_provider_reconciled', jsonb_build_object(
      'slug', 'vllm-local', 'is_enabled', true, 'endpoint', v_endpoint,
      'previous_endpoint', v_row.endpoint_url, 'previously_enabled', v_row.is_enabled,
      'models_marked_unavailable', v_models_reset));
    RAISE NOTICE 'vllm-local POVOLEN → % (modelů vedených jako nedostupné do discovery: %)', v_endpoint, v_models_reset;
  ELSE
    RAISE NOTICE 'vllm-local beze změny → %', v_endpoint;
  END IF;
END
$reconcile$;

COMMIT;
