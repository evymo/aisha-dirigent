-- ============================================================================
-- Source of Truth: get_data_source_feed_health_block
-- Popis: Stav a výkon zdrojů dat, které plní pluginy (maska `table`) — pro správu.
--        Jeden řádek = jeden zdroj s pluginem: zda smí běžet, zda běží, jak rychle
--        odpovídá dodavatel a kolik se stáhlo a zapsalo.
--
-- ⛔ PROČ VZNIKÁ. Naměřeno 2026-09-24 v produkci RIQ: tři zdroje byly v registru
-- „aktivní", dva měly pověření — a ani jeden nikdy neběžel (plugin `submitted`,
-- žádné rozvrhy). Nikdo to nehlásil týdny. Aktivní zdroj bez dat je PORUCHA,
-- ne klid; tahle tabulka ji pojmenuje dřív, než se na prázdnou plochu podívá člověk.
--
-- ⭐ VERDIKT (`stav`) jde po řetězu předpokladů a hlásí PRVNÍ, který chybí —
-- tedy to, co je potřeba udělat, ne jen že „něco nejde":
--   vypnuto → neschvaleno → bez_vlastnika → chybi_povereni → nezapaleno →
--   bez_rozvrhu → ticho → chyby → ok
--   · ticho   = žádný úspěšný běh za `silence_alert_hours` zdroje (výchozí 26 h —
--               denní synchronizace + rezerva), nebo nikdy;
--   · chyby   = v okně selhala aspoň polovina běhů.
--
-- Čísla za okno `hours` (výchozí 24) čte z plugin_health_events, kam je host
-- zapisuje po KAŽDÉM běhu (svc-plugin-system): doba běhu, volání ven (počet,
-- bajty, odezva, chyby), zapsané záznamy. NEMĚŘENO ≠ nula: kde běh nebyl,
-- je hodnota null, ne 0.
--
-- Pověření se hlásí JEN JMÉNY chybějících klíčů, nikdy hodnotou ani délkou.
-- Bezpečnost: SECURITY DEFINER (čte registr pověření a telemetrii), ale jen
-- správa (is_admin_or_staff); jiný volající dostane prázdnou tabulku.
-- Kontrakt: (jsonb) -> jsonb {data:{columns[], rows[]}, provenance}.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_data_source_feed_health_block(p_params jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hours int := LEAST(GREATEST(COALESCE(NULLIF(p_params->>'hours', '')::int, 24), 1), 24 * 31);
  v_rows  jsonb;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RETURN jsonb_build_object(
      'data', jsonb_build_object('columns', '[]'::jsonb, 'rows', '[]'::jsonb),
      'provenance', jsonb_build_object(
        'source_slug', 'plugin-health',
        'freshness_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'trace_id', 'data-source-feed-health:forbidden'));
  END IF;

  WITH zdroje AS (
    SELECT s.id AS source_id, s.source_slug, s.is_active, s.config,
           pc.id AS plugin_id, pc.slug AS plugin_slug, pc.status::text AS plugin_status,
           pc.config_schema,
           COALESCE(ps.user_id, ps.partner_id) AS tenant_id,
           (SELECT v.version FROM public.plugin_versions v
             WHERE v.plugin_id = pc.id ORDER BY v.created_at DESC LIMIT 1) AS verze
      FROM public.agent_knowledge_sources s
      JOIN public.plugin_catalog pc ON pc.id = s.source_plugin_id
      LEFT JOIN public.partner_stories ps ON ps.id = s.story_id
  ),
  povereni AS (
    SELECT z.source_id,
           (SELECT string_agg(k, ', ' ORDER BY k)
              FROM jsonb_each(COALESCE(z.config_schema->'properties', '{}'::jsonb)) AS e(k, v)
             WHERE COALESCE((v->>'secret')::boolean, false)
               AND COALESCE(z.config_schema->'required', '[]'::jsonb) ? k
               AND NOT EXISTS (SELECT 1 FROM public.agent_knowledge_source_secrets x
                                WHERE x.source_id = z.source_id AND x.secret_key = k)) AS chybi
      FROM zdroje z
  ),
  mereni AS (
    SELECT z.source_id,
           -- count(h.id), ne count(*): zdroj bez jediné události má z LEFT JOIN
           -- jeden prázdný řádek a count(*) by z něj udělal „1 běh".
           count(h.id) FILTER (WHERE COALESCE(h.metadata->>'trigger', '') <> 'zapaleni')              AS behu,
           count(h.id) FILTER (WHERE h.event_kind IN ('error', 'timeout'))                            AS chyb,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY h.latency_ms)
             FILTER (WHERE h.latency_ms IS NOT NULL)                                                 AS p95_ms,
           sum((h.metadata->'http'->>'calls')::bigint)                                               AS volani,
           sum((h.metadata->'http'->>'errors')::bigint)                                              AS volani_chyb,
           sum((h.metadata->'http'->>'bytes_in')::bigint)                                            AS bajtu,
           sum((h.metadata->'http'->>'ms_total')::bigint)                                            AS http_ms,
           sum((h.metadata->>'zapsano_celkem')::bigint)                                              AS zapsano
      FROM zdroje z
      LEFT JOIN public.plugin_health_events h
        ON h.plugin_id = z.plugin_id
       AND (z.tenant_id IS NULL OR h.tenant_id = z.tenant_id)
       AND h.recorded_at >= now() - make_interval(hours => v_hours)
     GROUP BY z.source_id
  ),
  posledni AS (
    SELECT z.source_id,
           (SELECT max(h.recorded_at) FROM public.plugin_health_events h
             WHERE h.plugin_id = z.plugin_id AND h.event_kind = 'invoke'
               AND COALESCE(h.metadata->>'trigger', '') <> 'zapaleni'
               AND (z.tenant_id IS NULL OR h.tenant_id = z.tenant_id)) AS posledni_ok,
           (SELECT count(*) FROM public.plugin_schedules ps2
             WHERE ps2.plugin_id = z.plugin_id AND ps2.enabled
               AND (z.tenant_id IS NULL OR ps2.tenant_id = z.tenant_id)) AS rozvrhu,
           (SELECT min(ps3.next_run_at) FROM public.plugin_schedules ps3
             WHERE ps3.plugin_id = z.plugin_id AND ps3.enabled
               AND (z.tenant_id IS NULL OR ps3.tenant_id = z.tenant_id)) AS dalsi_beh,
           d.status AS zapaleni, d.plugin_version AS zapaleno_verze
      FROM zdroje z
      LEFT JOIN public.plugin_declarations d
        ON d.plugin_id = z.plugin_id AND d.tenant_id = z.tenant_id
  ),
  radky AS (
    SELECT z.source_slug, z.plugin_slug, z.plugin_status, z.verze, z.is_active, z.tenant_id,
           p.chybi, m.behu, m.chyb, m.p95_ms, m.volani, m.volani_chyb, m.bajtu, m.http_ms, m.zapsano,
           l.posledni_ok, l.rozvrhu, l.dalsi_beh, l.zapaleni, l.zapaleno_verze,
           COALESCE(NULLIF(z.config->>'silence_alert_hours', '')::int, 26) AS ticho_h,
           (SELECT string_agg(c, ', ' ORDER BY c)
              FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(z.config->'granted_capabilities') = 'array'
                     THEN z.config->'granted_capabilities' ELSE '[]'::jsonb END) AS c) AS povoleno
      FROM zdroje z
      JOIN povereni p USING (source_id)
      JOIN mereni   m USING (source_id)
      JOIN posledni l USING (source_id)
  )
  -- Řádek ZÁMĚRNĚ bez `id`: detail zdroje zatím není kam otevřít a klikatelný
  -- řádek bez `row_kind` by shell otevřel jako doklad (prázdná karta, brána
  -- table-row-kind). Proklik přijde s administrací zdrojů spolu s druhem.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'zdroj',         r.source_slug,
           'plugin',        r.plugin_slug || COALESCE(' ' || r.verze, ''),
           'stav',          CASE
                              WHEN NOT r.is_active                                  THEN 'vypnuto'
                              WHEN r.plugin_status NOT IN ('canary', 'ga')          THEN 'neschvaleno'
                              WHEN r.tenant_id IS NULL                              THEN 'bez_vlastnika'
                              WHEN r.chybi IS NOT NULL                              THEN 'chybi_povereni'
                              WHEN r.zapaleni IS DISTINCT FROM 'ok'
                                OR r.zapaleno_verze IS DISTINCT FROM r.verze        THEN 'nezapaleno'
                              WHEN r.rozvrhu = 0                                    THEN 'bez_rozvrhu'
                              WHEN r.posledni_ok IS NULL
                                OR r.posledni_ok < now() - make_interval(hours => r.ticho_h) THEN 'ticho'
                              WHEN r.behu > 0 AND r.chyb * 2 >= r.behu              THEN 'chyby'
                              ELSE 'ok'
                            END,
           'plugin_stav',   r.plugin_status,
           'chybi_povereni', r.chybi,
           'povoleno',      r.povoleno,
           'rozvrhu',       r.rozvrhu,
           'dalsi_beh',     to_char(r.dalsi_beh AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'posledni_ok',   to_char(r.posledni_ok AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'behu',          NULLIF(r.behu, 0),
           'chyb',          CASE WHEN r.behu > 0 THEN r.chyb END,
           'p95_ms',        round(r.p95_ms)::bigint,
           'volani',        r.volani,
           'odezva_ms',     CASE WHEN r.volani > 0 THEN round(r.http_ms::numeric / r.volani)::bigint END,
           'volani_chyb',   r.volani_chyb,
           'stazeno_kb',    CASE WHEN r.bajtu IS NOT NULL THEN round(r.bajtu::numeric / 1024)::bigint END,
           'zapsano',       r.zapsano
         ) ORDER BY r.source_slug), '[]'::jsonb)
    INTO v_rows
    FROM radky r;

  RETURN jsonb_build_object(
    'data', jsonb_build_object(
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'zdroj',          'label_key', 'app.sources.col.source',          'align', 'left'),
        jsonb_build_object('key', 'stav',           'label_key', 'app.sources.col.state',           'align', 'left'),
        jsonb_build_object('key', 'plugin',         'label_key', 'app.sources.col.plugin',          'align', 'left'),
        jsonb_build_object('key', 'chybi_povereni', 'label_key', 'app.sources.col.missing_secrets', 'align', 'left'),
        jsonb_build_object('key', 'povoleno',       'label_key', 'app.sources.col.granted',         'align', 'left'),
        jsonb_build_object('key', 'rozvrhu',        'label_key', 'app.sources.col.schedules',       'align', 'right'),
        jsonb_build_object('key', 'dalsi_beh',      'label_key', 'app.sources.col.next_run',        'align', 'left'),
        jsonb_build_object('key', 'posledni_ok',    'label_key', 'app.sources.col.last_ok',         'align', 'left'),
        jsonb_build_object('key', 'behu',           'label_key', 'app.sources.col.runs',            'align', 'right'),
        jsonb_build_object('key', 'chyb',           'label_key', 'app.sources.col.errors',          'align', 'right'),
        jsonb_build_object('key', 'p95_ms',         'label_key', 'app.sources.col.p95_ms',          'align', 'right'),
        jsonb_build_object('key', 'volani',         'label_key', 'app.sources.col.calls',           'align', 'right'),
        jsonb_build_object('key', 'odezva_ms',      'label_key', 'app.sources.col.response_ms',     'align', 'right'),
        jsonb_build_object('key', 'volani_chyb',    'label_key', 'app.sources.col.call_errors',     'align', 'right'),
        jsonb_build_object('key', 'stazeno_kb',     'label_key', 'app.sources.col.downloaded_kb',   'align', 'right'),
        jsonb_build_object('key', 'zapsano',        'label_key', 'app.sources.col.written',         'align', 'right')),
      'rows', v_rows),
    'provenance', jsonb_build_object(
      'source_slug', 'plugin-health',
      'freshness_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'trace_id', 'data-source-feed-health:' || v_hours || 'h'));
END;
$$;

COMMENT ON FUNCTION public.get_data_source_feed_health_block(jsonb) IS
  'Admin table: per plugin-fed data source — first missing prerequisite (stav), schedules, last success, runs/errors/p95 and outbound calls/response/bytes/written rows over the window. Secrets by NAME only. Admin/staff; others get an empty table.';

REVOKE ALL ON FUNCTION public.get_data_source_feed_health_block(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_data_source_feed_health_block(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_data_source_feed_health_block(jsonb) TO authenticated, service_role;
