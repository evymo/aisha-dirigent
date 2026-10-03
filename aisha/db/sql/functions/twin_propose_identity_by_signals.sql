-- ============================================================================
-- Source of Truth: twin_propose_identity_by_signals
-- Popis: NÁVRHY vazeb identity ze SHODY SIGNÁLŮ napříč zdroji. Zdroj (plugin)
--        popíše své objekty (vozidlo: RZ, evidenční číslo, palubní jednotka…)
--        a tahle funkce najde dvojčata, jejichž reference JINÝCH zdrojů nesou
--        tutéž hodnotu. Čím víc nezávislých signálů se shoduje, tím vyšší
--        jistota návrhu — a tím snáz ho člověk potvrdí (dávkově, stejná třída).
--
-- ⛔ NIKDY NOVÉ DVOJČE. Objekt zdroje bez kandidáta zůstane nenapárovaný (jen
-- se spočítá). Dvojčata zakládá ingest, ne dodavatel telematiky — jinak by
-- každý zdroj vyrobil vlastní kopii téhož vozidla (majitel 2026-09-24:
-- „vazby z ingestu, potvrzené z několika stran").
--
-- ⛔ NIC NEPOTVRZUJE. Zakládá návrh přes twin_identity_propose_match, který
-- ctí lidské „NE" (zamítnutý pár se nevrací). Potvrzení je výhradně lidské
-- (kokpit → submit_evidence_review_audited → twin_identity_confirm_binding).
--
-- Platforma nezná jména polí dodavatele: řádek nese signály jako druhy
-- referencí (`ref_kind`), které už svět dvojčat používá. Adaptér zdroje říká,
-- který jeho údaj odpovídá kterému druhu — mapování je v pluginu, ne tady.
--
-- Vstup p_rows: [{ "source_key": "<id objektu ve zdroji>",
--                  "signals": [{ "kinds": ["vehicle_plate","vehicle_machine_plate"],
--                                "value": "1AB 2345", "weight": 0.6 }, …] }, …]
--   weight = síla jednoho signálu (0,05–0,9; výchozí 0,6). Jistota návrhu je
--   1 − Π(1 − weight) přes shodné signály, strop 0,95 (jistotu dává člověk).
--   Signály ukazující na VÍC dvojčat: návrh každému s poloviční jistotou —
--   rozpor dat patří před člověka, ne do tichého výběru.
--
-- Porovnání hodnot: velká písmena, bez mezer/pomlček/teček, bez úvodních nul
-- čistě číselného klíče („1AB-2345" = „1ab 2345", „0872" = „872").
--
-- Vrací: {objektu, potvrzeno, navrzeno, uz_navrzeno, zamitnuto_clovekem,
--         bez_kandidata, nejednoznacne}
--   (žádné klíče ani hodnoty — mohou to být osobní údaje)
-- Bezpečnost: SECURITY DEFINER; jen service_role (zdroj navrhuje, člověk potvrzuje).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.twin_propose_identity_by_signals(
  p_source      text,
  p_entity_type text,
  p_rows        jsonb,
  p_proposed_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source      text;
  v_row         jsonb;
  v_key         text;
  v_kand        jsonb;
  v_cand        jsonb;
  v_kandidatu   integer;
  v_res         jsonb;
  v_objektu     integer := 0;
  v_potvrzeno   integer := 0;
  v_navrzeno    integer := 0;
  v_uz          integer := 0;
  v_zamitnuto   integer := 0;
  v_bez         integer := 0;
  v_nejedno     integer := 0;
BEGIN
  -- Volá ji zdroj (plugin přes broker), ne člověk: člověk návrhy POTVRZUJE.
  IF NOT public.is_service_role() THEN
    RAISE EXCEPTION 'twin_propose_identity_by_signals: service role required'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_source), '') = '' OR coalesce(btrim(p_entity_type), '') = '' THEN
    RAISE EXCEPTION 'twin_propose_identity_by_signals: source and entity_type are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'twin_propose_identity_by_signals: p_rows must be a jsonb array'
      USING ERRCODE = '22023';
  END IF;
  -- Pohlcený zdroj se zapisuje pod toho, kdo ho pohltil (jedna identita).
  v_source := public.canonical_ingest_source(btrim(p_source));

  FOR v_row IN SELECT r FROM jsonb_array_elements(p_rows) AS r LOOP
    v_key := nullif(btrim(v_row->>'source_key'), '');
    CONTINUE WHEN v_key IS NULL;
    v_objektu := v_objektu + 1;

    -- Objekt, který už k dvojčeti patří, se znovu nenavrhuje.
    IF EXISTS (
      SELECT 1 FROM public.twin_external_refs r
       WHERE r.source = v_source AND r.source_key = v_key AND r.ref_kind = 'primary_id'
         AND r.state = 'confirmed' AND r.valid_to IS NULL
    ) THEN
      v_potvrzeno := v_potvrzeno + 1;
      CONTINUE;
    END IF;

    -- Kandidáti se spočítají jednou, návrhy se zakládají po nich.
    WITH sig AS (
      SELECT x.ord,
             ARRAY(SELECT jsonb_array_elements_text(x.s->'kinds')) AS kinds,
             regexp_replace(upper(regexp_replace(x.s->>'value', '[[:space:].-]', '', 'g')),
                            '^0+([0-9])', '\1') AS val,
             least(greatest(coalesce(
               CASE WHEN x.s->>'weight' ~ '^[0-9]+(\.[0-9]+)?$' THEN (x.s->>'weight')::numeric END,
               0.6), 0.05), 0.9) AS weight
        FROM jsonb_array_elements(coalesce(v_row->'signals', '[]'::jsonb)) WITH ORDINALITY AS x(s, ord)
       WHERE jsonb_typeof(x.s->'kinds') = 'array'
         AND coalesce(btrim(x.s->>'value'), '') <> ''
    ),
    shody AS (
      -- Jedna shoda = (dvojče, signál); víc referencí téhož signálu nesčítá.
      SELECT DISTINCT ON (r.twin_id, sig.ord) r.twin_id, sig.ord, sig.weight, r.ref_kind
        FROM sig
        JOIN public.twin_external_refs r
          ON r.ref_kind = ANY (sig.kinds)
         AND r.source <> v_source
         AND r.state IN ('proposed', 'confirmed')
         AND r.valid_to IS NULL
        JOIN public.twin_entities t
          ON t.id = r.twin_id AND t.entity_type = p_entity_type AND t.status = 'active'
       WHERE sig.val <> ''
         AND regexp_replace(upper(regexp_replace(r.source_key, '[[:space:].-]', '', 'g')),
                            '^0+([0-9])', '\1') = sig.val
       ORDER BY r.twin_id, sig.ord, (r.state = 'confirmed') DESC
    ),
    na_dvojce AS (
      SELECT s.twin_id,
             least(1 - exp(sum(ln(1 - s.weight))), 0.95) AS jistota,
             string_agg(DISTINCT s.ref_kind, '+' ORDER BY s.ref_kind) AS druhy
        FROM shody s
       GROUP BY s.twin_id
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'twin_id', n.twin_id, 'jistota', n.jistota, 'druhy', n.druhy)
             ORDER BY n.jistota DESC, n.twin_id), '[]'::jsonb)
      INTO v_kand
      FROM na_dvojce n;

    v_kandidatu := jsonb_array_length(v_kand);
    IF v_kandidatu = 0 THEN
      v_bez := v_bez + 1;
      CONTINUE;
    END IF;
    IF v_kandidatu > 1 THEN
      v_nejedno := v_nejedno + 1;
    END IF;

    FOR v_cand IN SELECT c FROM jsonb_array_elements(v_kand) AS c LOOP
      -- `proposed_by` nese DŮKAZ (které druhy se shodly), protože ho fronta
      -- ratifikace ukazuje — hodnoty ne, mohou to být osobní údaje.
      v_res := public.twin_identity_propose_match(
        (v_cand->>'twin_id')::uuid, v_source, v_key, 'primary_id',
        coalesce(nullif(btrim(p_proposed_by), ''), 'rule:signals') || ':' || (v_cand->>'druhy'),
        round((v_cand->>'jistota')::numeric / CASE WHEN v_kandidatu > 1 THEN 2 ELSE 1 END, 3),
        CASE WHEN v_kandidatu > 1
             THEN 'nejednoznačné: ' || v_kandidatu || ' kandidátů' END);
      CASE
        WHEN v_res->>'state' = 'skipped_rejected' THEN v_zamitnuto := v_zamitnuto + 1;
        WHEN coalesce((v_res->>'already')::boolean, false) THEN v_uz := v_uz + 1;
        ELSE v_navrzeno := v_navrzeno + 1;
      END CASE;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'objektu',            v_objektu,
    'potvrzeno',          v_potvrzeno,
    'navrzeno',           v_navrzeno,
    'uz_navrzeno',        v_uz,
    'zamitnuto_clovekem', v_zamitnuto,
    'bez_kandidata',      v_bez,
    'nejednoznacne',      v_nejedno
  );
END;
$$;

REVOKE ALL ON FUNCTION public.twin_propose_identity_by_signals(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.twin_propose_identity_by_signals(text, text, jsonb, text) TO service_role;
