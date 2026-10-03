-- =============================================================================
-- twin_ref_davky — deník HROMADNÉHO schválení návrhů identit (po položkách).
--
-- Majitel 2026-09-28: skupinu návrhů se shodou dvou nezávislých zdrojů pravdy
-- schválit najednou, „bez nutnosti každou klikat zvlášť" — a vše vratné, s původem
-- u dat. Dávka (twin_ref_group_decide) volá pro každou položku tutéž lidskou
-- ratifikaci jako jednotlivé schválení (twin_identity_confirm_binding); tenhle deník
-- nese, CO dávka udělala, aby šla vrátit po položkách v opačném pořadí
-- (twin_ref_davka_vratit) a aby se nevrátilo, co se mezitím změnilo.
--
-- vysledek:        potvrzeno | uz_potvrzeno (klíč už drželo totéž dvojče → návrh
--                  bezpředmětný) | chyba (položka neprošla, dávka jela dál)
-- stav_pred:       stav návrhu před dávkou (vždy proposed; drží se pro vrácení)
-- platnost_pred:   valid_from návrhu před dávkou (ratifikace ho přepíše na „teď")
-- potvrzeno_at:    confirmed_at, které dávka zapsala — vrací se jen nezměněné
-- vraceno:         vraceno | preskoceno_zmenene
--
-- Zápis jen twin_ref_group_decide / twin_ref_davka_vratit (správa, audit); RLS bez
-- politik, žádné granty.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.twin_ref_davky (
  batch_id      uuid        NOT NULL,
  poradi        integer     NOT NULL,
  ref_id        uuid        NOT NULL REFERENCES public.twin_external_refs (id) ON DELETE CASCADE,
  group_key     text        NOT NULL,
  vysledek      text        NOT NULL CHECK (vysledek IN ('potvrzeno', 'uz_potvrzeno', 'chyba')),
  chyba         text,
  stav_pred     text        NOT NULL,
  platnost_pred timestamptz NOT NULL,
  potvrzeno_at  timestamptz,
  provedl       uuid        NOT NULL,
  provedeno_at  timestamptz NOT NULL DEFAULT now(),
  vraceno       text        CHECK (vraceno IN ('vraceno', 'preskoceno_zmenene')),
  vraceno_at    timestamptz,
  vratil        uuid,
  CONSTRAINT twin_ref_davky_pkey PRIMARY KEY (batch_id, ref_id)
);

COMMENT ON TABLE public.twin_ref_davky IS
  'Deník hromadného schválení návrhů identit po položkách (výsledek, stav před, zapsané confirmed_at) — podklad pro vrácení dávky v opačném pořadí. Zápis jen twin_ref_group_decide / twin_ref_davka_vratit.';

ALTER TABLE public.twin_ref_davky ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.twin_ref_davky FROM PUBLIC, anon, authenticated;
