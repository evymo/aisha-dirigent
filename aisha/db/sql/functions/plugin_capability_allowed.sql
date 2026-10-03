-- ============================================================================
-- Source of Truth: plugin_capability_allowed
-- Popis: Smí plugin v tomto okamžiku použít danou schopnost? JEDINÉ místo, kde
--        se to rozhoduje — ptá se ho zápis rozvrhu (reconcile), zabrání
--        splatného rozvrhu (claim) i host před během (/execute, zapálení).
--
-- ⛔ PROČ VZNIKÁ. Naměřeno 2026-09-24 v produkci RIQ: `granted_capabilities`
-- zdroje dat (instanční data, např. Webdispečink bez `cron.poll_positions` —
-- rozhodnutí majitele „polohy ne") NEČETL NIKDO: ani host, ani shim, ani runner,
-- ani jediná SQL funkce. Plugin si v init() naplánuje, co chce, a po zapálení
-- rozvrhů by stahoval polohy à 5 min proti výslovnému rozhodnutí. Deklarace,
-- kterou nic nevynucuje, je jen komentář.
--
-- PRAVIDLO:
--   · Plugin NENAPOJENÝ na zdroj dat (agent, uzel, provider…) se tu neomezuje —
--     jeho schopnosti řídí manifest a přepis tenanta jako dosud.
--   · Plugin napojený na zdroj (agent_knowledge_sources.source_plugin_id) smí
--     jen schopnost, kterou AKTIVNÍ zdroj výslovně povolil v
--     `config.granted_capabilities`. Chybějící seznam = nic povoleno (default
--     deny): zdroj bez rozhodnutí o rozsahu nesmí stahovat „všechno".
--   · Vypnutý zdroj nesmí nic — vypnutí má zastavit stahování hned, ne až po
--     dalším zápisu rozvrhů.
--
-- Bezpečnost: SECURITY DEFINER (čte konfiguraci zdroje, na kterou volající
-- nemusí mít právo), jen služba. Neprozrazuje nic kromě ano/ne.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.plugin_capability_allowed(
  p_plugin_id  uuid,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_plugin_id IS NULL OR p_capability IS NULL OR btrim(p_capability) = '' THEN false
    WHEN NOT EXISTS (SELECT 1 FROM public.agent_knowledge_sources s
                      WHERE s.source_plugin_id = p_plugin_id) THEN true
    ELSE EXISTS (
      SELECT 1
        FROM public.agent_knowledge_sources s
       WHERE s.source_plugin_id = p_plugin_id
         AND s.is_active
         AND jsonb_typeof(s.config->'granted_capabilities') = 'array'
         AND (s.config->'granted_capabilities') ? p_capability)
  END;
$$;

COMMENT ON FUNCTION public.plugin_capability_allowed(uuid, text) IS
  'Smí plugin použít schopnost? Nenapojený na zdroj: ano (řídí manifest). Napojený: jen pokud AKTIVNÍ zdroj ji má v config.granted_capabilities (chybějící seznam = nic). Jen služba.';

REVOKE ALL ON FUNCTION public.plugin_capability_allowed(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.plugin_capability_allowed(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plugin_capability_allowed(uuid, text) TO service_role;
