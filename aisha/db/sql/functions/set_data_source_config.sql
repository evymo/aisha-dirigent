-- ============================================================================
-- Source of Truth: set_data_source_config
-- Popis: Změní konfiguraci zdroje dat z administrace. Slučuje, nepřepisuje.
--
-- ⛔ PROČ VZNIKÁ. Systém uměl zdroj ZALOŽIT s konfigurací (materialize_data_source)
-- a od 2026-09-01 ho i zapnout a vypnout — ale ZMĚNIT konfiguraci ne. Naměřeno
-- téhož dne: faktury se z ERP netahaly, protože zdroj měl v `doc_markers` jediný
-- marker, zatímco mapy pro obě faktury ležely v instančním bundlu hotové. Změna
-- na dva řádky se musela udělat přímým UPDATEm do databáze a zápis do žurnálu
-- dopsat ručně. Vznik měl cestu, změna ne.
--
-- ⭐ SLUČUJE, NEPŘEPISUJE. `config` nese i správu (owner, legal_basis, retention);
-- přepis celým objektem by je tiše shodil, protože volající pošle jen to, co mění.
--
-- ⭐ NEZNÁMÝ KLÍČ JE VADA, NE NOVÁ VLASTNOST. Překlep v názvu by se jinak zapsal
-- a NIC by neudělal — tichý no-op, tedy přesně ten tvar poruchy, který se nepozná.
-- Povolené klíče se NEVYJMENOVÁVAJÍ (druhý udržovaný seznam by se rozešel):
-- odvozují se z toho, co zdroj UŽ deklaruje. Vědomé přidání klíče se řekne
-- `p_allow_new_keys := true`.
--
-- ⛔ TAJEMSTVÍ SEM NEPATŘÍ. `config` je čitelná jsonb, kterou administrace
-- zobrazuje; pověření mají vlastní šifrovanou tabulku
-- (`agent_knowledge_source_secrets` + `set_data_source_secrets`).
--
-- ⚠️ CO TAHLE FUNKCE NEMĚŘÍ: že marker má v instančním bundlu mapu. Mapy nejsou
-- v databázi (žijí v bundlu a čte je engine), takže SQL na ně nedosáhne. Zapnout
-- marker bez mapy tedy jde — projeví se to tak, že doklady dorazí a engine je
-- nepřečte. Ověřuje se to spuštěním, ne tady.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_data_source_config(
  p_source_slug    text,
  p_patch          jsonb,
  p_allow_new_keys boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_source_id uuid;
  v_config    jsonb;
  v_nove      text[];
  v_tajne     text[];
  v_zmenene   text[];
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'set_data_source_config: p_patch musí být objekt {klíč: hodnota}';
  END IF;

  SELECT id, coalesce(config, '{}'::jsonb) INTO v_source_id, v_config
    FROM public.agent_knowledge_sources
   WHERE source_slug = p_source_slug;

  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'set_data_source_config: zdroj % neexistuje', p_source_slug;
  END IF;

  -- Pověření do konfigurace nepatří — mají šifrovanou tabulku.
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_tajne
    FROM jsonb_object_keys(p_patch) k
   WHERE k ~* '(heslo|password|secret|token|apikey|api_key|credential)';
  IF array_length(v_tajne, 1) > 0 THEN
    RAISE EXCEPTION 'set_data_source_config: % patří do set_data_source_secrets, ne do config',
      array_to_string(v_tajne, ', ');
  END IF;

  -- Neznámý klíč = překlep, dokud volající neřekne opak.
  IF NOT p_allow_new_keys THEN
    SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_nove
      FROM jsonb_object_keys(p_patch) k
     WHERE NOT (v_config ? k);
    IF array_length(v_nove, 1) > 0 THEN
      RAISE EXCEPTION 'set_data_source_config: zdroj % nemá klíče: %. Zdroj zná: %. Nový klíč se přidává s p_allow_new_keys := true.',
        p_source_slug,
        array_to_string(v_nove, ', '),
        coalesce((SELECT string_agg(k, ', ' ORDER BY k) FROM jsonb_object_keys(v_config) k), '(žádné)');
    END IF;
  END IF;

  -- Idempotence: co se hodnotou neliší, není změna.
  SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO v_zmenene
    FROM jsonb_object_keys(p_patch) k
   WHERE v_config -> k IS DISTINCT FROM p_patch -> k;

  IF array_length(v_zmenene, 1) IS NULL THEN
    RETURN jsonb_build_object('source_slug', p_source_slug, 'changed', '[]'::jsonb);
  END IF;

  UPDATE public.agent_knowledge_sources
     SET config = v_config || p_patch, updated_at = now()
   WHERE id = v_source_id;

  -- ⛔ Do žurnálu jdou JMÉNA klíčů a jen u nich stará/nová hodnota by mohla nést
  -- data zdroje — proto jen jména. Kdo chce vidět obsah, čte config.
  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'DATA_SOURCE_CONFIG_CHANGED', jsonb_build_object(
    'area', 'ingest', 'severity', 'warning',
    'source_slug', p_source_slug, 'source_id', v_source_id,
    'keys', to_jsonb(v_zmenene), 'new_keys_allowed', p_allow_new_keys
  ));

  RETURN jsonb_build_object('source_slug', p_source_slug, 'changed', to_jsonb(v_zmenene));
END;
$$;

COMMENT ON FUNCTION public.set_data_source_config(text, jsonb, boolean) IS
  'Sloučí patch do config zdroje. Neznámý klíč odmítne (překlep by byl tichý no-op), tajemství odkáže do set_data_source_secrets. Idempotentní, auditované. Admin/staff nebo service_role.';

REVOKE ALL ON FUNCTION public.set_data_source_config(text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_data_source_config(text, jsonb, boolean) TO authenticated, service_role;
