-- ============================================================================
-- Source of Truth: surface_section_overrides
-- Popis: ZÁKAZNICKÁ VRSTVA nad šablonou navigace (public.surface_sections).
--        Vlastní ji ADMINISTRACE a zapisuje se výhradně přes
--        set_surface_section_override_admin — deploy soubor se jí nikdy nedotkne.
--
--        Všechny osy jsou NULLABLE a null znamená „platí šablona"; efektivní
--        hodnota = coalesce(override, šablona), reset = smazání řádku. Proto
--        smí instance overlay šablonu opravovat a rozšiřovat, aniž přepíše, co
--        si zákazník přejmenoval nebo přesunul.
--
--        ON DELETE CASCADE je záměr: sekce, kterou deploy už nedeklaruje, nemá
--        co ladit — její override zmizí s ní.
--
--        Jména VÝHRADNĚ klíči (title_key/group_key/reason_key) do `translations`,
--        nikdy uložený text: přejmenování v administraci je upsert překladu.
-- RLS: ENABLED — politika v sql/policies/surface_section_overrides_read.sql,
--        granty v sql/grants/surface_tables.sql, trigger v sql/triggers/.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.surface_section_overrides (
  surface      text PRIMARY KEY REFERENCES public.surface_sections(surface) ON DELETE CASCADE,
  title_key    text,
  icon         text,
  group_key    text,
  group_order  integer,
  position     integer,
  state        text CHECK (state IS NULL OR state IN ('active', 'inactive')),
  reason_key   text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES aisha_auth.users(id)
);

COMMENT ON TABLE public.surface_section_overrides IS
  'Zákaznické úpravy šablony sekcí (vlastní administrace, zapisuje se výhradně přes set_surface_section_override_admin). NULL sloupec = platí šablona.';

ALTER TABLE public.surface_section_overrides ENABLE ROW LEVEL SECURITY;
