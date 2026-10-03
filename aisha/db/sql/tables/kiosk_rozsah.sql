-- ============================================================================
-- Table: kiosk_rozsah — CO smí vidět tablet (účet zařízení) — DATA instance
-- ============================================================================
-- F2 (2026-09-29, majitel: „tablet nabídne dnešní rozvozy naší dopravy podle řidiče
-- i podle vozidla, bez osobních údajů“). Rozsah je DATA instance, ne kód: kterého
-- kroku procesu se týká (`step_code`) a které běhy jsou „naše“ (`input_match` —
-- containment nad input_data, např. dopravce). Pátá cesta workflow_step_visible_to
-- pustí účet zařízení JEN ke krokům, které tady některý aktivní řádek pokrývá.
--
-- `pole` = DEKLAROVANÁ projekce (revize Aisha Guru 29. 9.): co z input_data smí
-- tablet dostat. Výpis pro tablet vrací JEN tato pole — osoby zákazníka (příjemce,
-- kontakty odběratele, telefon, e-mail) na tablet nikdy; popisek řidiče jen tak,
-- jak ho vede evidence. Prázdné pole = nic navíc.
--
-- Zápis: hák dat instance (service role). Klienti tabulku nečtou ani nepíšou —
-- RLS zapnuté bez politik, čte ji jen definer predikátu a výpisu.
--
-- ⭐ 2026-09-30 (majitel přes RIQi): „podle SPZ a podle řidiče, z našich řidičů —
-- co máme spárované s Webdispečinkem. To, že je to naše doprava, má pomáhat ingestu,
-- ale nemá si to sám řešit tablet.“ Řádek s `jen_flotila = true` proto „naše“ NEURČUJE
-- sám: pustí jen krok, který patří naší flotile podle POTVRZENÉHO párování řidiče nebo
-- vozidla s Webdispečinkem (`kiosk_krok_nasi_flotily`); `input_match` je pak jen
-- zúžení (prázdný objekt = každý běh toho kroku, pokud patří naší flotile).
-- Řádek s `jen_flotila = false` (výchozí, chování F2) rozhoduje sám přes `input_match`.
-- ⭐ PŘECHOD ŘÍDÍ DATA, NE NASAZENÍ (revize RIQi 30. 9.): dokud párování s Webdispečinkem
-- v datech není, drží tablet řádky podle dopravce; vypne je až krok dat instance.
-- Projekce (`pole`) je sjednocení řádků, které krok pokrývají VSTUPEM — řádky jednoho
-- kroku proto mají mít stejnou projekci (kiosk_projekce flotilu neřeší).
--
-- `okno_zpet` / `okno_dopredu` = kolik dní před/po dnešku ukázat NEDORUČENÉ kroky
-- (výchozí 0/0 = jen dnešek, chování F2). `zdroj_stav` = kdy zdroj (účetnictví)
-- hlásí doklad jako vyřízený, tvar jako `source_state` bloku řidičovy pásky:
-- {field, closed_when, stable_key?}. Takový krok tablet mezi nedoručenými neukáže.
-- Jména polí jsou DATA instance — platforma žádné účetnictví nejmenuje.
--
-- `pole_polozek` (2026-09-30, majitel: „nevidím detail dodávky — co, kolik a čeho
-- odvézt“) = DEKLAROVANÁ projekce POLOŽEK dokladu kroku pro tablet
-- (get_workflow_step_polozky): které klíče řádku dokladu smí na tablet (např. název,
-- množství, jednotka). Prázdné = tablet položky nedostane (fail-closed).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.kiosk_rozsah (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kod text NOT NULL,
  step_code text NOT NULL,
  input_match jsonb NOT NULL DEFAULT '{}'::jsonb,
  pole text[] NOT NULL DEFAULT '{}'::text[],
  popis text,
  aktivni boolean NOT NULL DEFAULT true,
  okno_zpet integer NOT NULL DEFAULT 0 CONSTRAINT kiosk_rozsah_okno_zpet_rozsah CHECK (okno_zpet BETWEEN 0 AND 31),
  okno_dopredu integer NOT NULL DEFAULT 0 CONSTRAINT kiosk_rozsah_okno_dopredu_rozsah CHECK (okno_dopredu BETWEEN 0 AND 31),
  zdroj_stav jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT kiosk_rozsah_zdroj_stav_objekt CHECK (jsonb_typeof(zdroj_stav) = 'object'),
  jen_flotila boolean NOT NULL DEFAULT false,
  pole_polozek text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT kiosk_rozsah_kod_key UNIQUE (kod),
  CONSTRAINT kiosk_rozsah_input_match_objekt CHECK (jsonb_typeof(input_match) = 'object'),
  CONSTRAINT kiosk_rozsah_step_code_neprazdny CHECK (length(step_code) > 0)
);

-- Existující DB (F2 z kola 12) sloupce nemá — `CREATE TABLE IF NOT EXISTS` je nedoplní.
ALTER TABLE public.kiosk_rozsah
  ADD COLUMN IF NOT EXISTS okno_zpet integer NOT NULL DEFAULT 0
    CONSTRAINT kiosk_rozsah_okno_zpet_rozsah CHECK (okno_zpet BETWEEN 0 AND 31),
  ADD COLUMN IF NOT EXISTS okno_dopredu integer NOT NULL DEFAULT 0
    CONSTRAINT kiosk_rozsah_okno_dopredu_rozsah CHECK (okno_dopredu BETWEEN 0 AND 31),
  ADD COLUMN IF NOT EXISTS zdroj_stav jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT kiosk_rozsah_zdroj_stav_objekt CHECK (jsonb_typeof(zdroj_stav) = 'object'),
  ADD COLUMN IF NOT EXISTS jen_flotila boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pole_polozek text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.kiosk_rozsah ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kiosk_rozsah FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kiosk_rozsah TO service_role;
