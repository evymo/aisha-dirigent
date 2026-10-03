-- =============================================================================
-- submit_plugin(p_artifact_sha256, p_artifact_url, p_manifest)
-- =============================================================================
-- Creates a new plugin entry in plugin_catalog + (optionally) an initial version.
-- Status starts as 'submitted'. Logs to plugin_audit_events.
--
-- Authorization (two distinct publisher classes):
--   * admin/staff       — may submit ANY plugin kind (executable artifact required).
--   * certified partner — may submit ONLY kind='agent' (agent marketplace).
--                         The submission is identity-bound (author_partner_id) and
--                         forced to trust_tier='partner'.
--
-- Artifact is OPTIONAL: declarative agents (kind='agent', run-as-story) carry no
-- code artifact — their template lives in plugin_catalog.agent_spec and no
-- plugin_versions row is created. Every non-agent plugin (and executable/call-mode
-- agents, Phase 2) MUST provide artifact_sha256 + artifact_url.
--
-- Re-submission upserts by slug. A certified partner may only re-submit a slug
-- they already own; admin/staff may re-submit anything. Partners cannot hijack an
-- admin-owned (author_partner_id IS NULL) slug.
--
-- Approval on re-submission (canary/ga): kept when nothing changed; CARRIED OVER
-- to new code when admin/staff submits an internal plugin whose permissions do
-- not expand (owner decision 2026-09-27, audit PLUGIN_APPROVAL_CARRIED_OVER);
-- otherwise reset to 'submitted' (audit PLUGIN_APPROVAL_RESET with the reason).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_plugin(
  p_artifact_sha256 text DEFAULT NULL,
  p_artifact_url    text DEFAULT NULL,
  p_manifest        jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plugin_id      uuid;
  v_version_id     uuid;
  v_user_id        uuid := auth.uid();
  v_slug           text;
  v_version        text;
  v_kind           text;
  v_is_admin       boolean;
  v_partner_id     uuid;
  v_trust_tier     public.plugin_trust_tier;
  v_existing_owner uuid;
  v_slug_exists    boolean;
  v_puvodni        public.plugin_catalog%ROWTYPE;
  v_beze_zmeny     boolean := false;
  v_status         public.plugin_status;
  v_prenos         boolean := false;   -- schválení se přenese na nový kód (viz níž)
  v_rozsireni      text[]  := '{}';    -- co by nová verze ROZŠÍŘILA (důvod resetu)
  v_zmeneno        text[]  := '{}';    -- co se změnilo BEZ rozšíření (do auditu přenosu)
  v_puvodni_verze  text;
  v_puvodni_sha    text;
  v_sb_old         jsonb;
  v_sb_new         jsonb;
  v_k              text;
BEGIN
  -- ⭐ SYSTÉMOVÝ PLUGIN SMÍ PODAT STROJ, AKTIVOVAT HO SMÍ JEN ČLOVĚK.
  --
  -- Rozhodnutí majitele 2026-09-04: „spíš bych byl pro to, aby to službě mohl
  -- uživatel povolit a následně schválit … systémové pluginy by mohly stačit
  -- u servisních rolí."
  --
  -- Do dneška vyžadovalo podání `auth.uid()`, protože je to model PODÁNÍ:
  -- někdo nabízí, někdo schvaluje. U pluginů, které přicházejí S PLATFORMOU,
  -- ale žádný „někdo" není — jsou součástí nasazení. Vynucený uživatel proto
  -- znamenal, že heslo bootstrap účtu muselo ležet v compose (rohatka
  -- `build-time-mnozina` to právem odmítla: 62 tajemství proti stropu 60).
  --
  -- ⛔ CO SERVISNÍ ROLE **NESMÍ**, a proč je to bezpečné:
  --   · `trust_tier` je natvrdo `internal` — stroj NIKDY nepodá `partner`
  --     ani `external`; ty dál vyžadují člověka s odpovědností.
  --   · `status` zůstává výchozí `submitted`. Podání NENÍ aktivace: do provozu
  --     se plugin dostane až přes `transition_plugin_status`, které vyžaduje
  --     `is_admin_or_staff()`. Stroj tedy smí NAVRHNOUT, ne ZAPNOUT.
  --   · `author_partner_id` zůstává NULL — strojové podání nemá autora
  --     a nesmí se tvářit, že ho má.
  IF public.is_service_role() AND v_user_id IS NULL THEN
    v_is_admin   := false;
    v_trust_tier := 'internal';
    v_partner_id := NULL;
  ELSIF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_manifest IS NULL THEN
    RAISE EXCEPTION 'Manifest is required';
  END IF;

  v_slug    := p_manifest->>'id';
  v_version := p_manifest->>'version';
  v_kind    := p_manifest->>'kind';

  -- Validate required fields
  IF v_slug IS NULL OR v_version IS NULL OR v_kind IS NULL THEN
    RAISE EXCEPTION 'Manifest must contain id, version and kind';
  END IF;

  -- ===== AUTHORIZATION =====
  IF v_trust_tier IS NULL THEN
  v_is_admin := public.is_admin_or_staff();
  IF v_is_admin THEN
    -- Admin/staff: any kind; trust tier from manifest (default external).
    v_trust_tier := COALESCE((p_manifest->>'trust_tier')::public.plugin_trust_tier, 'external');
  ELSIF public.is_certified_partner() AND v_kind = 'agent' THEN
    -- Certified guild member: agents only, identity-bound, partner trust tier.
    SELECT id INTO v_partner_id
      FROM public.partner_profiles
     WHERE user_id = v_user_id;
    IF v_partner_id IS NULL THEN
      RAISE EXCEPTION 'Certified partner profile not found for caller';
    END IF;
    v_trust_tier := 'partner';
  ELSIF public.current_user_has_permission('publish_plugins') THEN
    -- ⭐ ÚZKÁ PUBLIKAČNÍ DRÁHA pro SERVISNÍ účty (naměřeno 2026-09-02).
    --
    -- Bez ní musí stroj, který má do katalogu dostat NAŠE vlastní pluginy,
    -- dostat roli `admin`/`staff` — a tím i všechno ostatní, co ta role smí.
    -- Hůř: až někdo staffovi přidá další právo, servisní účet ho TIŠE dostane
    -- taky, aniž by takové rozhodnutí kdokoli udělal. Role odpovídá na „kdo to
    -- je“, oprávnění na „co smí“; servisní účet není staff, má JEDEN úkol.
    --
    -- ⛔ TIER JE PEVNÝ, NEVOLÍ SE Z MANIFESTU. Tím je tahle cesta UŽŠÍ než
    -- adminova, i když publikuje důvěryhodnější obsah: admin si tier vybírá,
    -- tenhle účet ne — takže nemůže vydat cizí plugin za interní. Kdyby si tier
    -- směl zvolit, bylo by udělené právo fakticky mocnější než role, kterou
    -- nahrazuje, a celý smysl zúžení by padl.
    v_trust_tier := 'internal';
  ELSE
    RAISE EXCEPTION
      'Unauthorized: admin/staff may submit any plugin; certified partners may submit agents only; a holder of the publish_plugins permission may submit internal plugins';
  END IF;
  END IF;

  -- ===== ARTIFACT INVARIANT =====
  -- Non-agent plugins always ship code. Agents may be declarative (no artifact).
  IF v_kind <> 'agent' AND (p_artifact_sha256 IS NULL OR p_artifact_url IS NULL) THEN
    RAISE EXCEPTION 'Plugin kind % requires artifact_sha256 and artifact_url', v_kind;
  END IF;

  -- ===== OWNERSHIP PRE-CHECK (re-submission) =====
  SELECT author_partner_id INTO v_existing_owner
    FROM public.plugin_catalog
   WHERE slug = v_slug;
  v_slug_exists := FOUND;

  IF v_slug_exists AND NOT v_is_admin THEN
    -- A certified partner may only re-submit a slug they already own.
    IF v_existing_owner IS DISTINCT FROM v_partner_id THEN
      RAISE EXCEPTION 'Plugin slug % exists and is not owned by you', v_slug;
    END IF;
  END IF;

  -- Upsert plugin catalog (slug conflict → re-submit / new version)
  -- ⛔ NAMĚŘENO 2026-09-16: ON CONFLICT natvrdo nastavil status='submitted'.
  -- `plugin-publish-init` volá submit_plugin při KAŽDÉM nasazení core, takže
  -- člověkem schválený plugin (canary/ga) spadl zpět na submitted, katalog ho
  -- přestal vydávat a /execute vracel 404 — po každém deployi.
  --
  -- Reset ale není jen vada: katalog servíruje NEJNOVĚJŠÍ verzi a
  -- `plugin_versions` ON CONFLICT (plugin_id, version) přepíše artefakt. Reset
  -- byl jediné, co bránilo, aby pod schváleným pluginem běžel jiný kód. Proto se
  -- schválení zachová JEN tehdy, když se nezměnilo nic, co schvaloval člověk:
  -- druh, důvěra, capabilities, sandbox, konfigurace, lifecycle, všechny spec
  -- — a KÓD (táž verze se stejným otiskem artefaktu už je zapsaná). Jméno,
  -- popis a autor schválení neruší.
  SELECT * INTO v_puvodni FROM public.plugin_catalog WHERE slug = v_slug;
  IF FOUND THEN
    v_beze_zmeny :=
          v_puvodni.kind::text       IS NOT DISTINCT FROM v_kind
      AND v_puvodni.trust_tier       IS NOT DISTINCT FROM v_trust_tier
      AND v_puvodni.capabilities     IS NOT DISTINCT FROM COALESCE(p_manifest->'capabilities', '[]'::jsonb)
      AND v_puvodni.config_schema    IS NOT DISTINCT FROM p_manifest->'config_schema'
      AND v_puvodni.sandbox_policy   IS NOT DISTINCT FROM p_manifest->'sandbox'
      AND v_puvodni.lifecycle        IS NOT DISTINCT FROM p_manifest->'lifecycle'
      AND v_puvodni.agent_spec       IS NOT DISTINCT FROM p_manifest->'agent_spec'
      AND v_puvodni.provider_spec    IS NOT DISTINCT FROM p_manifest->'provider_spec'
      AND v_puvodni.node_spec        IS NOT DISTINCT FROM p_manifest->'node_spec'
      AND v_puvodni.auth_spec        IS NOT DISTINCT FROM p_manifest->'auth_spec'
      AND v_puvodni.tracking_spec    IS NOT DISTINCT FROM p_manifest->'tracking_spec'
      AND v_puvodni.source_spec      IS NOT DISTINCT FROM p_manifest->'source_spec'
      AND (
        -- deklarativní podání (bez artefaktu) kód nemění
        (p_artifact_sha256 IS NULL AND p_artifact_url IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.plugin_versions pv
           WHERE pv.plugin_id = v_puvodni.id
             AND pv.version = v_version
             AND pv.artifact_sha256 = p_artifact_sha256
        )
      );

    -- ⭐ PŘENESENÍ SCHVÁLENÍ NA NOVÝ KÓD (rozhodnutí majitele 2026-09-27: „schválení
    -- se přenáší"). NAMĚŘENO téhož dne: každé kolo s novou verzí pluginu vrátilo
    -- T-CARS / Webdispečink / AVP na `submitted` a data přestala téct, dokud někdo
    -- neklikl „Schválit do provozu". Člověk schvaluje OPRÁVNĚNÍ, ne každý build.
    --
    -- Přenese se jen tehdy, když
    --   · plugin JE schválený (canary/ga) a podání NENÍ shodné (to řeší v_beze_zmeny);
    --   · podává SPRÁVA (admin/staff — plugin-publish-init nese AISHA_ADMIN_JWT).
    --     Holá servisní role dál jen NAVRHUJE (doktrína výš): její token drží víc
    --     služeb a podvržený kód by jinak běžel bez člověka;
    --   · důvěra je `internal` před i po (kód z CI vlastního repa) a druh se nemění;
    --   · nic z toho, co je OPRÁVNĚNÍ, se nerozšíří:
    --       capabilities, sandbox.rpc_allowlist, sandbox.network_allowlist — jen ⊆;
    --       sandbox.timeout_ms, sandbox.max_memory_mb — jen ≤ (strop zdrojů);
    --       ostatní klíče sandboxu, source_spec.source_slug a .namespace (KAM plugin
    --       zapisuje — broker podle source_slug pouští p_source_slug), agent/provider/
    --       node/auth/tracking_spec (registrované chování, obecně neklasifikovatelné)
    --       — beze změny.
    -- Oprávněním NENÍ: kód (verze, otisk), lifecycle (vstupní soubor, strategie
    -- načtení), config_schema (JAKÁ pole plugin čte — hodnoty dává instance ze
    -- zdroje, ne katalog), source_spec.adapter_entry a .default_config (výchozí
    -- rozvrh a meze; konfigurace instance při materializaci vyhrává).
    IF NOT v_beze_zmeny AND v_puvodni.status IN ('canary'::public.plugin_status, 'ga'::public.plugin_status) THEN
      SELECT pv.version, pv.artifact_sha256 INTO v_puvodni_verze, v_puvodni_sha
        FROM public.plugin_versions pv WHERE pv.plugin_id = v_puvodni.id
       ORDER BY pv.created_at DESC LIMIT 1;

      IF v_puvodni.kind::text IS DISTINCT FROM v_kind THEN v_rozsireni := v_rozsireni || 'kind'::text; END IF;
      IF v_puvodni.trust_tier IS DISTINCT FROM v_trust_tier THEN v_rozsireni := v_rozsireni || 'trust_tier'::text; END IF;

      -- Množiny: prvek nové verze, který v původní není (neřetězcový prvek se nepozná
      -- jako shodný — počítá se jako rozšíření, raději reset než tichý průchod).
      SELECT v_rozsireni || COALESCE(array_agg('capabilities: +' || x ORDER BY x), '{}')
        INTO v_rozsireni
        FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_manifest->'capabilities') = 'array'
                                            THEN p_manifest->'capabilities' ELSE '[]'::jsonb END) x
       WHERE NOT (COALESCE(v_puvodni.capabilities, '[]'::jsonb) ? x);

      v_sb_old := CASE WHEN jsonb_typeof(v_puvodni.sandbox_policy) = 'object' THEN v_puvodni.sandbox_policy ELSE '{}'::jsonb END;
      v_sb_new := CASE WHEN jsonb_typeof(p_manifest->'sandbox') = 'object' THEN p_manifest->'sandbox' ELSE '{}'::jsonb END;
      FOREACH v_k IN ARRAY ARRAY['rpc_allowlist', 'network_allowlist'] LOOP
        SELECT v_rozsireni || COALESCE(array_agg(format('sandbox.%s: +%s', v_k, x) ORDER BY x), '{}')
          INTO v_rozsireni
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_sb_new->v_k) = 'array' THEN v_sb_new->v_k ELSE '[]'::jsonb END) x
         WHERE NOT (CASE WHEN jsonb_typeof(v_sb_old->v_k) = 'array' THEN v_sb_old->v_k ELSE '[]'::jsonb END ? x);
      END LOOP;
      FOREACH v_k IN ARRAY ARRAY['timeout_ms', 'max_memory_mb'] LOOP
        IF (v_sb_new->v_k) IS DISTINCT FROM (v_sb_old->v_k)
           AND NOT (jsonb_typeof(v_sb_new->v_k) = 'number' AND jsonb_typeof(v_sb_old->v_k) = 'number'
                    AND (v_sb_new->>v_k)::numeric <= (v_sb_old->>v_k)::numeric) THEN
          v_rozsireni := v_rozsireni || format('sandbox.%s: %s → %s', v_k,
                                               COALESCE(v_sb_old->>v_k, '∅'), COALESCE(v_sb_new->>v_k, '∅'));
        END IF;
      END LOOP;
      FOR v_k IN SELECT k FROM (SELECT jsonb_object_keys(v_sb_old) AS k UNION SELECT jsonb_object_keys(v_sb_new)) s
                  WHERE k NOT IN ('rpc_allowlist', 'network_allowlist', 'timeout_ms', 'max_memory_mb') ORDER BY k LOOP
        IF (v_sb_new->v_k) IS DISTINCT FROM (v_sb_old->v_k) THEN v_rozsireni := v_rozsireni || ('sandbox.' || v_k); END IF;
      END LOOP;

      IF (v_puvodni.source_spec IS NULL) IS DISTINCT FROM (p_manifest->'source_spec' IS NULL)
         OR (v_puvodni.source_spec->>'source_slug') IS DISTINCT FROM (p_manifest->'source_spec'->>'source_slug') THEN
        v_rozsireni := v_rozsireni || 'source_spec.source_slug'::text;
      END IF;
      IF (v_puvodni.source_spec->>'namespace') IS DISTINCT FROM (p_manifest->'source_spec'->>'namespace') THEN
        v_rozsireni := v_rozsireni || 'source_spec.namespace'::text;
      END IF;
      IF v_puvodni.agent_spec    IS DISTINCT FROM p_manifest->'agent_spec'    THEN v_rozsireni := v_rozsireni || 'agent_spec'::text;    END IF;
      IF v_puvodni.provider_spec IS DISTINCT FROM p_manifest->'provider_spec' THEN v_rozsireni := v_rozsireni || 'provider_spec'::text; END IF;
      IF v_puvodni.node_spec     IS DISTINCT FROM p_manifest->'node_spec'     THEN v_rozsireni := v_rozsireni || 'node_spec'::text;     END IF;
      IF v_puvodni.auth_spec     IS DISTINCT FROM p_manifest->'auth_spec'     THEN v_rozsireni := v_rozsireni || 'auth_spec'::text;     END IF;
      IF v_puvodni.tracking_spec IS DISTINCT FROM p_manifest->'tracking_spec' THEN v_rozsireni := v_rozsireni || 'tracking_spec'::text; END IF;

      -- Co se změnilo BEZ rozšíření — audit přenosu říká, co správa nepřezkoumala.
      IF v_puvodni_sha IS DISTINCT FROM p_artifact_sha256 THEN v_zmeneno := v_zmeneno || 'kód'::text; END IF;
      IF v_puvodni.capabilities   IS DISTINCT FROM COALESCE(p_manifest->'capabilities', '[]'::jsonb) THEN v_zmeneno := v_zmeneno || 'capabilities (zúžení)'::text; END IF;
      IF v_puvodni.sandbox_policy IS DISTINCT FROM p_manifest->'sandbox'      THEN v_zmeneno := v_zmeneno || 'sandbox (zúžení)'::text; END IF;
      IF v_puvodni.config_schema  IS DISTINCT FROM p_manifest->'config_schema' THEN v_zmeneno := v_zmeneno || 'config_schema'::text; END IF;
      IF v_puvodni.lifecycle      IS DISTINCT FROM p_manifest->'lifecycle'     THEN v_zmeneno := v_zmeneno || 'lifecycle'::text; END IF;
      IF v_puvodni.source_spec    IS DISTINCT FROM p_manifest->'source_spec'   THEN v_zmeneno := v_zmeneno || 'source_spec (adapter_entry/default_config)'::text; END IF;

      v_prenos := v_is_admin
              AND v_trust_tier = 'internal'::public.plugin_trust_tier
              AND v_puvodni.trust_tier = 'internal'::public.plugin_trust_tier
              AND cardinality(v_rozsireni) = 0;
    END IF;
  END IF;

  INSERT INTO public.plugin_catalog (
    slug, name, description, author,
    kind, trust_tier, capabilities,
    config_schema, sandbox_policy, lifecycle, agent_spec,
    -- ⛔ VŠECH ŠEST DRUHŮ, NE JEN AGENT. Naměřeno 2026-09-06: tři pluginy
    -- `kind=data_source` dorazily do katalogu, došly až do `ga` — a materializace
    -- je TIŠE přeskočila (`{skipped: 'no source_spec'}`), protože `source_spec`
    -- se sem nikdy nezapsal. Zdroj `webdispecink-fleet` tak zůstal `is_active`
    -- BEZ vykonavatele, `plugin_schedules` prázdné a z ingestu nevyšlo nic.
    -- Tabulka ty sloupce má a jejich komentář říká, že matching `materialize_*`
    -- je jejich JEDINÝ čtenář; když je nikdo nenaplní, čtenář nemá co číst.
    -- Týž tvar jako `materialize_plugin` popisuje o patro výš (6 druhů
    -- deklarováno, 1 zapojen) — jen o úroveň níž, v zápisu místo v dispečeru.
    provider_spec, node_spec, auth_spec, tracking_spec, source_spec,
    author_partner_id
  ) VALUES (
    v_slug,
    p_manifest->>'name',
    p_manifest->>'description',
    p_manifest->>'author',
    v_kind::public.plugin_kind,
    v_trust_tier,
    COALESCE(p_manifest->'capabilities', '[]'::jsonb),
    p_manifest->'config_schema',
    p_manifest->'sandbox',
    p_manifest->'lifecycle',
    p_manifest->'agent_spec',
    p_manifest->'provider_spec',
    p_manifest->'node_spec',
    p_manifest->'auth_spec',
    p_manifest->'tracking_spec',
    p_manifest->'source_spec',
    v_partner_id
  )
  ON CONFLICT (slug) DO UPDATE SET
    name          = EXCLUDED.name,
    description   = EXCLUDED.description,
    author        = EXCLUDED.author,
    kind          = EXCLUDED.kind,
    trust_tier    = EXCLUDED.trust_tier,
    capabilities  = EXCLUDED.capabilities,
    config_schema = EXCLUDED.config_schema,
    sandbox_policy = EXCLUDED.sandbox_policy,
    lifecycle     = EXCLUDED.lifecycle,
    agent_spec    = EXCLUDED.agent_spec,
    provider_spec = EXCLUDED.provider_spec,
    node_spec     = EXCLUDED.node_spec,
    auth_spec     = EXCLUDED.auth_spec,
    tracking_spec = EXCLUDED.tracking_spec,
    source_spec   = EXCLUDED.source_spec,
    -- Preserve the original owner once set (admin updates never null it out).
    author_partner_id = COALESCE(plugin_catalog.author_partner_id, EXCLUDED.author_partner_id),
    status        = CASE WHEN v_beze_zmeny OR v_prenos THEN plugin_catalog.status
                         ELSE 'submitted'::public.plugin_status END,
    updated_at    = now()
  RETURNING id, status INTO v_plugin_id, v_status;

  -- Create version record only when an artifact is supplied.
  IF p_artifact_sha256 IS NOT NULL AND p_artifact_url IS NOT NULL THEN
    INSERT INTO public.plugin_versions (
      plugin_id, version, artifact_sha256, artifact_url, submitted_by
    ) VALUES (
      v_plugin_id, v_version, p_artifact_sha256, p_artifact_url, v_user_id
    )
    ON CONFLICT (plugin_id, version) DO UPDATE SET
      artifact_sha256 = EXCLUDED.artifact_sha256,
      artifact_url    = EXCLUDED.artifact_url,
      submitted_by    = EXCLUDED.submitted_by
    RETURNING id INTO v_version_id;
  END IF;

  -- Přenos schválení: registr podle nové verze (týž krok jako přechod do canary/ga
  -- v transition_plugin_status — „schválený manifest ⇒ řádek registru"; konfigurace
  -- instance při tom vyhrává a is_active se nemění) + audit, CO se nepřezkoumalo.
  IF v_prenos THEN
    PERFORM public.materialize_plugin(v_plugin_id);
    INSERT INTO public.plugin_audit_events (plugin_id, actor_id, action, metadata)
    VALUES (v_plugin_id, v_user_id, 'PLUGIN_APPROVAL_CARRIED_OVER', jsonb_build_object(
      'slug', v_slug, 'status', v_status::text,
      'from_version', v_puvodni_verze, 'to_version', v_version,
      'from_artifact_sha256', v_puvodni_sha, 'to_artifact_sha256', p_artifact_sha256,
      'zmeneno', to_jsonb(v_zmeneno),
      'duvod', 'internal, podává správa, oprávnění nerozšířena (rozhodnutí majitele 2026-09-27)'));
  ELSIF v_puvodni.id IS NOT NULL AND NOT v_beze_zmeny
        AND v_puvodni.status IN ('canary'::public.plugin_status, 'ga'::public.plugin_status) THEN
    -- Reset schváleného pluginu se HLÁSÍ i s důvodem — správa vidí, CO má přezkoumat.
    INSERT INTO public.plugin_audit_events (plugin_id, actor_id, action, metadata)
    VALUES (v_plugin_id, v_user_id, 'PLUGIN_APPROVAL_RESET', jsonb_build_object(
      'slug', v_slug, 'from_status', v_puvodni.status::text,
      'from_version', v_puvodni_verze, 'to_version', v_version,
      'rozsireni', to_jsonb(v_rozsireni),
      'duvod', CASE
        WHEN cardinality(v_rozsireni) > 0 THEN 'nová verze rozšiřuje oprávnění'
        WHEN NOT COALESCE(v_is_admin, false) THEN 'podání strojem (servisní role) schválení nepřenáší'
        ELSE 'důvěra není internal' END));
  END IF;

  -- Audit log
  INSERT INTO public.plugin_audit_events (plugin_id, actor_id, action, metadata)
  VALUES (
    v_plugin_id, v_user_id, 'PLUGIN_SUBMITTED',
    jsonb_build_object(
      'version', v_version,
      'slug', v_slug,
      'kind', v_kind,
      'trust_tier', v_trust_tier::text,
      'declarative', (v_version_id IS NULL),
      'author_partner_id', v_partner_id
    )
  );

  RETURN jsonb_build_object(
    'plugin_id', v_plugin_id,
    'version_id', v_version_id,
    'slug', v_slug,
    'version', v_version,
    'kind', v_kind,
    'status', v_status::text,
    'schvaleni_zachovano', v_beze_zmeny OR v_prenos,
    'schvaleni_preneseno', v_prenos,
    'rozsireni', to_jsonb(v_rozsireni)
  );
END;
$$;

COMMENT ON FUNCTION public.submit_plugin(text, text, jsonb) IS
  'Submit a new plugin/agent or new version. Admin/staff (any kind) or certified partners (agents only). Artifact optional for declarative agents.';

REVOKE ALL ON FUNCTION public.submit_plugin(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_plugin(text, text, jsonb) TO authenticated;
-- ⭐ Servisní role smí podat SYSTÉMOVÝ plugin (viz větev `is_service_role()`
-- v těle). Grant je nutný, ale sám o sobě nic neotevírá: funkce servisní roli
-- natvrdo přiděluje `trust_tier='internal'`, `author_partner_id=NULL`
-- a výchozí `status='submitted'`. Do provozu se plugin dostane až přes
-- `transition_plugin_status`, které vyžaduje `is_admin_or_staff()` — stroj
-- tedy smí NAVRHNOUT, ne ZAPNOUT.
GRANT EXECUTE ON FUNCTION public.submit_plugin(text, text, jsonb) TO service_role;
