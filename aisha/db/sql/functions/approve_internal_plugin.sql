-- ============================================================================
-- Source of Truth: approve_internal_plugin
-- Popis: Správce schválí NÁŠ VLASTNÍ plugin (trust_tier `internal`) do provozu
--        jedním úkonem — stavový automat se projde až do `canary`.
--
-- ⛔ PROČ VZNIKÁ (naměřeno 2026-09-26 v produkci instance): zdroje
-- `webdispecink-fleet` a `tcars-fleet` jsou aktivní, pověření vyplněná — a ani
-- jeden nikdy nestahoval. Oba pluginy byly člověkem posunuté až do `ga`
-- (2026-09-07 i 2026-09-20), ale další nasazení s novým kódem je vrátilo na
-- `submitted`. To je SPRÁVNĚ (`submit_plugin`: schválení drží jen shodný otisk
-- artefaktu — pod schváleným pluginem nesmí běžet jiný kód), jenže znovu
-- schválit nebylo kde: `transition_plugin_status` nevolá žádné UI ani služba,
-- fronta moderace pluginy nenese. Pojistka „stroj navrhne, člověk zapne" tak
-- měla jen první půlku — a z pojistky se stala trvalá zeď.
--
-- ⭐ JEN `internal`. Interní plugin staví a publikuje NAŠE CI z našeho repa
-- (`submit_plugin` ho strojem jinak než jako internal podat neumí) a jeho kód
-- prošel branami PR. Sandbox test ze stavového automatu (`sandbox_testing →
-- approved`, v pravidlech „auto po průchodu sandboxem") tu nahrazuje právě tohle
-- — a metadata každého kroku to říkají nahlas. Partner a external dál vyžadují
-- skutečné přezkoumání přes `transition_plugin_status` krok po kroku.
--
-- ⭐ KAŽDÝ KROK JDE PŘES `transition_plugin_status`. Pravidla přechodů
-- (`plugin_transition_rules`), role, materializace a audit zůstávají JEDINÝM
-- domovem — tady se jen volají za sebou v jedné transakci. Odmítne-li automat
-- kterýkoli krok, spadne celé schválení (nic napůl).
--
-- ⭐ Schvaluje se KONKRÉTNÍ artefakt: do metadat každého kroku jde verze
-- a otisk nejnovějšího artefaktu, takže audit říká, CO přesně správce pustil.
-- Když nasazení přinese jiný kód, `submit_plugin` plugin vrátí na `submitted`
-- a stav zdrojů (`get_data_source_feed_health_block`) ukáže „neschváleno".
--
-- Idempotentní: `canary`/`ga` = nic se nemění (`zmena: false`). Vypnutý nebo
-- archivovaný plugin se tudy NEschvaluje — vypnutí je vědomé rozhodnutí a jeho
-- zrušení patří do přezkoumání (`disabled → reviewing`), ne do jednoho kliknutí.
--
-- Bezpečnost: SECURITY DEFINER + stráž `is_admin_or_staff()` (automat by ji
-- stejně vynutil u každého kroku; tady je dřív, aby cizí volající nezjistil
-- ani existenci pluginu). Volá se z plochy přes `surface_actions`.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_internal_plugin(p_plugin_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c_cesta    CONSTANT text[] := ARRAY['reviewing', 'sandbox_testing', 'approved', 'canary'];
  v_id       uuid;
  v_status   public.plugin_status;
  v_tier     public.plugin_trust_tier;
  v_version  text;
  v_sha      text;
  v_krok     text;
  v_vysledek jsonb;
  v_kroky    jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'approve_internal_plugin: jen správa (admin/staff)' USING ERRCODE = '42501';
  END IF;

  IF p_plugin_slug IS NULL OR btrim(p_plugin_slug) = '' THEN
    RAISE EXCEPTION 'approve_internal_plugin: chybí slug pluginu' USING ERRCODE = '22023';
  END IF;

  SELECT pc.id, pc.status, pc.trust_tier
    INTO v_id, v_status, v_tier
    FROM public.plugin_catalog pc
   WHERE pc.slug = p_plugin_slug
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_internal_plugin: plugin % není v katalogu', p_plugin_slug USING ERRCODE = '22023';
  END IF;

  IF v_tier IS DISTINCT FROM 'internal'::public.plugin_trust_tier THEN
    RAISE EXCEPTION 'approve_internal_plugin: plugin % má důvěru %, jedním úkonem se schvaluje jen internal — projděte přezkoumání krok po kroku',
      p_plugin_slug, v_tier USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('canary'::public.plugin_status, 'ga'::public.plugin_status) THEN
    RETURN jsonb_build_object('ok', true, 'slug', p_plugin_slug, 'status', v_status::text,
                              'zmena', false, 'kroky', '[]'::jsonb);
  END IF;

  IF v_status IN ('disabled'::public.plugin_status, 'archived'::public.plugin_status) THEN
    RAISE EXCEPTION 'approve_internal_plugin: plugin % je %, vypnutí se ruší přezkoumáním (disabled → reviewing), ne jedním kliknutím',
      p_plugin_slug, v_status USING ERRCODE = '22023';
  END IF;

  SELECT pv.version, pv.artifact_sha256
    INTO v_version, v_sha
    FROM public.plugin_versions pv
   WHERE pv.plugin_id = v_id
   ORDER BY pv.created_at DESC
   LIMIT 1;
  IF v_sha IS NULL THEN
    RAISE EXCEPTION 'approve_internal_plugin: plugin % nemá artefakt — není co schválit', p_plugin_slug USING ERRCODE = '22023';
  END IF;

  FOREACH v_krok IN ARRAY c_cesta LOOP
    -- Stav, který už je na cestě za tímhle krokem, se přeskočí (submitted na
    -- cestě není → array_position NULL → projde se od začátku).
    IF array_position(c_cesta, v_status::text) >= array_position(c_cesta, v_krok) THEN
      CONTINUE;
    END IF;
    v_vysledek := public.transition_plugin_status(
      p_metadata   => jsonb_build_object(
                        'via', 'approve_internal_plugin',
                        'version', v_version,
                        'artifact_sha256', v_sha,
                        'sandbox', 'internal: kód z CI vlastního repa místo sandbox testu'),
      p_new_status => v_krok,
      p_plugin_id  => v_id);
    IF NOT coalesce((v_vysledek->>'success')::boolean, false) THEN
      RAISE EXCEPTION 'approve_internal_plugin: krok → % odmítnut: %', v_krok, coalesce(v_vysledek->>'error', v_vysledek::text)
        USING ERRCODE = '42501';
    END IF;
    v_kroky := v_kroky || to_jsonb(v_krok);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'slug', p_plugin_slug, 'status', 'canary', 'zmena', true,
                            'kroky', v_kroky, 'version', v_version, 'artifact_sha256', v_sha);
END;
$$;

COMMENT ON FUNCTION public.approve_internal_plugin(text) IS
  'Admin/staff: approve OUR OWN (trust_tier internal) plugin into production in one action — walks transition_plugin_status up to canary, audit per step with the approved artifact hash. Idempotent; refuses partner/external and disabled/archived.';

REVOKE ALL ON FUNCTION public.approve_internal_plugin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_internal_plugin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_internal_plugin(text) TO authenticated;
