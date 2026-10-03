-- ============================================================================
-- Source of Truth: twin_external_refs
-- Popis: Mapování externích identit na dvojčata (= „external_entity_refs"
--        ze zadání digital twin) S RATIFIKAČNÍM WORKFLOW: zdroj/pravidlo
--        vazbu NAVRHUJE (proposed, s evidencí proposed_by/confidence),
--        člověk POTVRZUJE (confirmed + confirmed_by = audit trail).
--        Import NIKDY nepřepisuje potvrzené — nová evidence na potvrzený
--        klíč vzniká jako další proposed řádek (review, ne overwrite).
--        Vazby jsou TEMPORÁLNÍ (valid_from/valid_to): čip/vůz se předává,
--        účet se ruší — historie se neztrácí, ukončuje se platnost.
--        Unikátnost aktivního vlastníka klíče vynucuje partial unique index
--        uq_twin_external_refs_active_owner (Dallas čip nemůže patřit dvěma
--        lidem naráz).
--        Spravováno: twin_upsert_entity_audited (primary_id z importu,
--        confirmed_by NULL = systémové potvrzení identity vlastního zdroje)
--        a twin_identity_*_binding RPC (lidská ratifikace cross-source vazeb)
--        a claim_invitation (vazba účtu z UPLATNĚNÉ POZVÁNKY). Ta zapisuje
--        DVĚMA způsoby a rozdíl je podstatný: pozvánka je propojení BUDOUCÍ
--        identity s entitou, takže autorizaci předpřipravil odesílatel — otázka
--        při uplatnění není „smí?", ale „je to on?".
--          · ADRESOVANÁ (e-mail pozvánky = e-mail účtu) → `confirmed`,
--            `confirmed_by` = správce, který ji vystavil (rozhodl on).
--          · NEADRESOVANÁ (kód předaný jinak) → `proposed`; není koho ověřit,
--            takže předpřipravená autorizace nemá nositele a ratifikuje člověk.
-- RLS: ENABLED
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.twin_external_refs (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  twin_id       uuid         NOT NULL REFERENCES public.twin_entities(id) ON DELETE CASCADE,
  source        text         NOT NULL,
  source_key    text         NOT NULL,
  ref_kind      text         NOT NULL DEFAULT 'primary_id',
  -- Druh dvojčete, na které vazba ukazuje — ODVOZENÝ (trigger z twin_entities),
  -- nikdy od volajícího. Je součástí klíče jedinečnosti potvrzené vazby.
  entity_type   text         NOT NULL,
  state         text         NOT NULL DEFAULT 'proposed'
                CHECK (state IN ('proposed', 'confirmed', 'rejected', 'superseded')),
  proposed_by   text         NOT NULL,
  confidence    numeric      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  valid_from    timestamptz  NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  note          text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT twin_external_refs_source_not_blank CHECK (btrim(source) <> ''),
  CONSTRAINT twin_external_refs_key_not_blank CHECK (btrim(source_key) <> ''),
  CONSTRAINT twin_external_refs_kind_not_blank CHECK (btrim(ref_kind) <> ''),
  -- ⛔ MODEL A ČTENÁŘ SI NESMÍ PROTIŘEČIT (2026-09-10).
  -- Obecně `source` ROZLIŠUJE: týž klíč ve dvou zdrojích jsou dvě různé věci
  -- (osobní číslo ve Webdispečinku × osobní číslo jinde spolu nesouvisejí).
  -- U vazby ÚČTU to ale neplatí — účet je jeden bez ohledu na to, kdo o něm
  -- píše — a `workflow_step_visible_to` proto `source` VŮBEC NEČTE.
  --
  -- Ten rozpor se dosud jen zakrýval indexem. Index je pojistka; tohle je
  -- odstranění nejednoznačnosti: u `account` smí být jediná hodnota, takže
  -- dvě vazby na týž účet z různých zdrojů NEJDE ani vyrobit.
  CONSTRAINT twin_external_refs_account_source
    CHECK (ref_kind <> 'account' OR source = 'aisha_auth'),
  CONSTRAINT twin_external_refs_confirmed_has_at
    CHECK (state <> 'confirmed' OR confirmed_at IS NOT NULL),
  CONSTRAINT twin_external_refs_validity_order
    CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

COMMENT ON TABLE public.twin_external_refs IS 'Externí identity dvojčat s ratifikací (proposed→confirmed) a temporální platností; import nikdy nepřepisuje potvrzené';
COMMENT ON COLUMN public.twin_external_refs.source IS 'Volný slug zdroje (webdispecink/erp/keycloak/…) — seznam zdrojů jsou instance data, jádro vendor enum nemá';
COMMENT ON COLUMN public.twin_external_refs.source_key IS 'Klíč v externím systému (iddriver, carid, dallas čip, osobní číslo, user id…)';
COMMENT ON COLUMN public.twin_external_refs.ref_kind IS 'Druh vazby: primary_id (identita ve vlastním zdroji) / field_identity (čip v terénu) / hr_ref / account / calendar… — volný slug, slovník je doménová volba';
COMMENT ON COLUMN public.twin_external_refs.proposed_by IS 'Evidence návrhu: ''import'' | ''rule:<slug>'' | ''human:<uuid>''';
COMMENT ON COLUMN public.twin_external_refs.confirmed_by IS 'Kdo ratifikoval (auth.uid()); NULL = systémové potvrzení primární identity vlastního zdroje importem';
COMMENT ON COLUMN public.twin_external_refs.valid_to IS 'Konec platnosti (předání čipu, zrušení účtu) — řádek zůstává jako historie, state se nemění';

ALTER TABLE public.twin_external_refs ENABLE ROW LEVEL SECURITY;

-- ⛔ NA ŽIVOU DATABÁZI SE CHECK Z `CREATE TABLE` NEDOSTANE (tabulka existuje),
-- takže se přidává zvlášť a idempotentně.
--
-- ⚠️ `NOT VALID` JE VĚDOMÉ. Ověřit existující řádky odsud nejde: produkci
-- nevidím (dveře odmítly, HTTP 403), takže bych `ALTER` psal naslepo a
-- migrace by spadla na datech, o kterých nic nevím. `NOT VALID` vymáhá
-- podmínku na VŠECH nových a měněných řádcích, jen nesahá na historii —
-- a tu kryjí indexy. Ověřit ji jde kdykoli později:
--     ALTER TABLE public.twin_external_refs
--       VALIDATE CONSTRAINT twin_external_refs_account_source;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'twin_external_refs_account_source'
       AND conrelid = 'public.twin_external_refs'::regclass
  ) THEN
    ALTER TABLE public.twin_external_refs
      ADD CONSTRAINT twin_external_refs_account_source
      CHECK (ref_kind <> 'account' OR source = 'aisha_auth') NOT VALID;
  END IF;
END
$$;

-- ⭐ DRUH ENTITY V KLÍČI VAZBY (2026-09-27). Vazba byla jedinečná jen
-- v (source, source_key, ref_kind). Zdroj, který čísluje dva druhy objektů
-- zvlášť (T-cars vozidloId × osobaId, Eurowag monitoredObjectId × driver id),
-- pak pod holým číslem kolidoval: potvrzené vozidlo 5 „zabralo" klíč osoby 5,
-- návrh pro osobu se tiše přeskočil jako potvrzený, resolve u jízdy vrátil za
-- řidiče vozidlo a twin_upsert_entity_audited by osobě přepsal vozidlo.
--
-- Na živé DB: sloupec přidat a DOPLNIT z dvojčete, na které vazba ukazuje.
-- NOT NULL a hlídání druhu nastaví až triggers/twin_external_refs_entity_type.sql
-- (běží po funkcích): kdyby byl sloupec povinný dřív, než ho trigger umí
-- doplnit, starý kód aplikace by během nasazení vazby zakládat nemohl.
DO $$
BEGIN
  ALTER TABLE public.twin_external_refs ADD COLUMN IF NOT EXISTS entity_type text;
  UPDATE public.twin_external_refs r
     SET entity_type = t.entity_type
    FROM public.twin_entities t
   WHERE t.id = r.twin_id
     AND r.entity_type IS DISTINCT FROM t.entity_type;
END
$$;

-- Komentář až PO přidání sloupce: na živé DB CREATE TABLE IF NOT EXISTS nic
-- nezaloží a komentář nad chybějícím sloupcem by shodil migraci (změřeno
-- upgrade testem nad DB předchozího mainu 2026-09-27).
COMMENT ON COLUMN public.twin_external_refs.entity_type IS 'Druh dvojčete (kopie twin_entities.entity_type, udržuje trigger) — součást jedinečnosti: týž klíč zdroje smí patřit vozidlu i osobě, protože zdroje číslují druhy zvlášť';
