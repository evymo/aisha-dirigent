-- ============================================================================
-- Source of Truth: surface_client_params_filter
-- Popis: KONTRAKT KLIENTSKÝCH PARAMETRŮ restricted bloku (ADR-003, program K3).
--   Z parametrů volajícího propustí JEN klíče, které konfigurace bloku výslovně
--   deklaruje v `source_params.client_params`, jejichž hodnota projde
--   deklarovaným typem, a které NEKOLIDUJÍ s klíčem konfigurace.
--
-- PROČ: W4 (2026-09-03) správně zavřel díru U4-5 — restricted blok nebral
-- parametry klienta vůbec, protože `columns` nebo `view` od klienta by nad
-- definer zdrojem (běží pod právy vlastníka) znamenaly čtení libovolných
-- sloupců napříč RLS.
-- Jenže tím zmizela i legální cesta pro detail záznamu (`twin_id`), hledání
-- (`q`) a osu pohledu (`cohort_id`). Jediný způsob, jak parametr protlačit,
-- bylo označit blok `internal` — obcházení, ne návrh. Tohle je návrh:
--   · deklarace je DATA (řádek bloku v overlayi), ne kód;
--   · typ se ověřuje (uuid, text ≤200, date, timestamptz, int, bool, enum);
--   · konfigurace zůstává AUTORITATIVNÍ — deklarovaný klíč, který už
--     konfigurace nese, se nepropustí nikdy (klient si `view` nepřepíše, ani
--     kdyby ho instance omylem deklarovala);
--   · nedeklarovaný nebo neplatný klíč se tiše zahodí — blok vrátí to, co
--     vydá konfigurace sama (poctivá degradace, žádná výjimka).
--
-- Tvar deklarace:
--   "client_params": {"twin_id":"uuid", "q":"text", "since":"date",
--                     "tier":{"enum":["registered","active"]}, "n":"int", "flag":"bool"}
--
-- ⭐ OBJEKTOVÁ DEKLARACE (2026-09-29, ovladače v extranetu). Tentýž parametr smí nést
-- i to, jak ho má shell NABÍDNOUT — popisek, druh ovladače, popisky hodnot:
--   "mesic":     {"type":"date", "ui":"month", "label_key":"…"}
--   "min_days":  {"type":"int", "ui":"toggle", "on":365, "label_key":"…"}
--   "jen_tridy": {"enum":["N","E","P"], "multi":true, "label_key":"…", "value_label_prefix":"…"}
-- Typ se u objektu čte z `type` (nebo z `enum`); UI klíče tu nic neznamenají — shell
-- je dostane přes get_surface_layout_ui. `multi` = pole řetězců, každý z výčtu (1–50).
-- Řetězcová deklarace platí beze změny.
--
-- IMMUTABLE: čistá funkce svých argumentů, nic nečte. INVOKER: nemá co obcházet.
-- (Pozn. pro analyzátor bran: v komentáři záměrně není literál definer velkými
-- písmeny — security.gate čte soubory textově a vzal by ho za deklaraci
-- funkce bez autorizace.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.surface_client_params_filter(p_source_params jsonb, p_client jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(jsonb_object_agg(d.key, c.value), '{}'::jsonb)
  FROM jsonb_each(
         CASE WHEN jsonb_typeof(p_source_params->'client_params') = 'object'
              THEN p_source_params->'client_params' ELSE '{}'::jsonb END) AS d(key, spec)
  -- Typ parametru: řetězcová deklarace JE typ; objektová ho nese v `type`.
  CROSS JOIN LATERAL (
    SELECT CASE WHEN jsonb_typeof(d.spec) = 'object' THEN d.spec->>'type' ELSE d.spec #>> '{}' END AS ty
  ) AS t
  JOIN jsonb_each(coalesce(p_client, '{}'::jsonb)) AS c(key, value) ON c.key = d.key
  WHERE d.key <> 'client_params'
    -- konfigurace je autoritativní: klíč, který konfigurace nese, klient nepřepíše
    AND NOT ((coalesce(p_source_params, '{}'::jsonb) - 'client_params') ? d.key)
    AND (
      CASE
        WHEN jsonb_typeof(d.spec) = 'object' AND d.spec ? 'enum' AND d.spec->'multi' = 'true'::jsonb
          THEN jsonb_typeof(c.value) = 'array'
           AND jsonb_array_length(c.value) BETWEEN 1 AND 50
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.value) AS e(v)
                            WHERE jsonb_typeof(e.v) <> 'string' OR NOT (d.spec->'enum') ? (e.v #>> '{}'))
        WHEN jsonb_typeof(d.spec) = 'object' AND d.spec ? 'enum'
          THEN jsonb_typeof(c.value) = 'string' AND (d.spec->'enum') ? (c.value #>> '{}')
        WHEN t.ty = 'uuid'
          THEN jsonb_typeof(c.value) = 'string'
           AND (c.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        WHEN t.ty = 'text'
          THEN jsonb_typeof(c.value) = 'string'
           AND length(c.value #>> '{}') BETWEEN 1 AND 200
        WHEN t.ty = 'date'
          THEN jsonb_typeof(c.value) = 'string'
           AND (c.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        WHEN t.ty = 'timestamptz'
          THEN jsonb_typeof(c.value) = 'string'
           AND (c.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}'
        WHEN t.ty = 'int'
          THEN (jsonb_typeof(c.value) = 'number' AND (c.value #>> '{}') ~ '^-?[0-9]+$')
            OR (jsonb_typeof(c.value) = 'string' AND (c.value #>> '{}') ~ '^-?[0-9]{1,9}$')
        WHEN t.ty = 'bool'
          THEN jsonb_typeof(c.value) = 'boolean'
        ELSE false
      END);
$$;

REVOKE ALL ON FUNCTION public.surface_client_params_filter(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.surface_client_params_filter(jsonb, jsonb) TO authenticated, service_role;
