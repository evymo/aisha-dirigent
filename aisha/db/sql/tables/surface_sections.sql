-- ============================================================================
-- Source of Truth: surface_sections
-- Popis: NAVIGACE JAKO DATA — ŠABLONA sekcí extranetu, kterou vlastní OVERLAY
--        INSTANCE (deploy): jaké sekce existují, klíč jména, ikona, skupina,
--        pořadí, výchozí stav a publikum.
--
--        Zákaznické úpravy žijí VEDLE, v public.surface_section_overrides
--        (vlastní administrace). Efektivní hodnota = coalesce(override, šablona),
--        takže deploy smí šablonu opravovat a rozšiřovat, aniž smaže, co si
--        zákazník přejmenoval; reset = smazání override. Jedna tabulka se dvěma
--        zapisovateli by nekonvergovala nikdy — přesně jako kdysi rozvržení.
--
--        VŠE PŘES KLÍČE: title_key/group_key/reason_key míří do `translations`
--        (key, namespace, locale) — tam, kde žijí překlady stránek i dotazníků.
--        Přejmenování sekce v administraci = upsert překladu pod klíčem, NIKDY
--        uložený řetězec v jednom jazyce.
--
--        Stav 'inactive' = sekce deklarovaná, ale bez napojeného zdroje:
--        v navigaci VIDITELNÁ, zašedlá, s důvodem (reason_key). Skrýt ji by
--        zákazníkovi tvrdilo, že to produkt neumí; nechat ji aktivní by ukázalo
--        prázdno, které vypadá jako chyba.
--
--        Sekce s bloky ŠABLONU NEPOTŘEBUJE — list_surface_sections ji odvodí
--        z rozvržení jako dosud. Šablona jen přidává: skupinu, pořadí, ikonu
--        a deklarované neaktivní sekce. Instance bez šablony funguje beze změny.
-- RLS: ENABLED — politika v sql/policies/surface_sections_read.sql, granty
--        v sql/grants/surface_tables.sql, trigger updated_at v sql/triggers/.
--        Rozdělení do těch složek NENÍ kosmetika: baseline emituje tables/ PŘED
--        functions/, takže trigger volající public.set_updated_at() musí přijít
--        až z triggers/, jinak cold start padne na neexistující funkci.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.surface_sections (
  surface      text PRIMARY KEY,
  title_key    text,
  icon         text,
  group_key    text,
  group_order  integer      NOT NULL DEFAULT 0,
  position     integer      NOT NULL DEFAULT 0,
  state        text         NOT NULL DEFAULT 'active'
               CHECK (state IN ('active', 'inactive')),
  reason_key   text,
  -- Publikum ŠABLONOVÉ sekce (hlavně těch neaktivních — ty nemají rozvržení,
  -- takže je RLS nad surface_layouts neořeže). Týž interpret jako všude:
  -- surface_audience_allows; {} = každý přihlášený, neznámý klíč = DENY.
  audience     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean      NOT NULL DEFAULT true,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT surface_sections_surface_not_blank CHECK (btrim(surface) <> '')
);

COMMENT ON TABLE public.surface_sections IS
  'Šablona navigace extranetu (vlastní instance overlay). Override vrstvu vlastní administrace; efektivní hodnota = coalesce(override, šablona).';

-- ⭐ SONDA DAT (rozhodnutí majitele 2026-09-28): „pokud nemá žádná data, která
-- má možnost vidět, není potřeba, aby danou sekci viděl, byť do ní má přístup."
-- Deklarace, podle které list_surface_sections sekci běžnému uživateli skryje,
-- když pro něj nic nemá (správa vidí vždy). Druhy: {"doklady": ["contract", …]}
-- = existuje aspoň jeden platný doklad těch typů, který uživatel pod RLS vidí.
-- Sonda NENÍ hranice přístupu (tu drží publikum a RLS): chybná deklarace sekci
-- neskryje. NULL = bez sondy.
ALTER TABLE public.surface_sections ADD COLUMN IF NOT EXISTS presence jsonb
  CHECK (presence IS NULL OR jsonb_typeof(presence) = 'object');

ALTER TABLE public.surface_sections ENABLE ROW LEVEL SECURITY;
