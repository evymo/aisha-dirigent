-- ============================================================================
-- Source of Truth: twin_parameter_definitions
-- Popis: Metadatový katalog vlastností dvojčat (ParameterDefinition ze zadání
--        digital twin §4): nové parametry se přidávají DATY, ne změnou schématu
--        či extranetu. Odděluje surová data (source = slug zdroje) od
--        dopočítaných metrik (source = 'computed') a ručních vstupů.
--        Tvar 1:1 s instance katalogem (riq_parameter_definitions.v1:
--        code/name/entityType/dataType/unit/source/aggregation/description) —
--        JSON v gitu je autor, tato tabulka je runtime, seed je most.
--        Hodnoty parametrů NEŽIJÍ tady: vysokofrekvenční telemetrie zůstává
--        ve zdrojových silech (wd_* current/history) a čte se přes VIEW/RPC
--        s mapováním přes tento katalog; materializují se jen slow-changing
--        observations a události (twin_events). Žádná duplikace dat.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.twin_parameter_definitions (
  code           text         PRIMARY KEY,
  name           text         NOT NULL,
  entity_type    text         NOT NULL,
  data_type      text         NOT NULL,
  unit           text,
  source         text,
  aggregation    text,
  historization  text,
  description    text,
  metadata       jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT twin_parameter_definitions_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT twin_parameter_definitions_entity_type_not_blank CHECK (btrim(entity_type) <> '')
);

COMMENT ON TABLE public.twin_parameter_definitions IS 'Katalog vlastností dvojčat — parametry se přidávají daty; hodnoty žijí ve zdrojových silech/twin_events, ne tady';
COMMENT ON COLUMN public.twin_parameter_definitions.code IS 'Stabilní kód parametru (utilization_percent, meter_water_m3…) — klíč pro API i seed';
COMMENT ON COLUMN public.twin_parameter_definitions.source IS 'Původ hodnoty: slug zdroje (webdispecink…) / computed / manual / field_capture — volný slug, instance slovník';
COMMENT ON COLUMN public.twin_parameter_definitions.aggregation IS 'Způsob agregace (last/sum/daily/monotonic_last/event_log…) — volný slug dle instance katalogu';
COMMENT ON COLUMN public.twin_parameter_definitions.historization IS 'Jak se hodnota historizuje: current / timeseries / slowly_changing / event_log — řídí, kde hodnota žije a jak se čte';

ALTER TABLE public.twin_parameter_definitions ENABLE ROW LEVEL SECURITY;
