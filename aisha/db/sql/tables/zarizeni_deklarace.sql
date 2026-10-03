-- =============================================================================
-- zarizeni_deklarace — deklarace schopnosti „zařízení" (Kiosk Admin a appky,
-- které rozdává) jako DOSLOVNÁ kopie `zarizeni/hlidac.json` z dat instance.
--
-- ⭐ PROČ V DATABÁZI (domluveno 2026-09-24, RIQ Driver + RIQi). Deklarace dosud
-- vedla derivací doktora → trezor → env `ZARIZENI_HLIDAC`. Trezor je ale
-- rozhodnutím majitele MIMO CI, takže „samo, ale po vyžádání" (sloučení v datech
-- instance → nasazení) by na tomhle kroku vždy skončilo ručním zápisem. Hák dat
-- instance (scripts/deploy/instance-data-hook.sh) sem deklaraci zapíše při každém
-- nasazení core a storage-auth ji čte RPC za běhu — bez trezoru a bez přenasazení.
--
-- ⛔ 1:1, NE NORMALIZOVANĚ. Tvar ověřuje CI dat instance PŘED sloučením a
-- storage-auth při čtení (fail-closed s důvodem). Třetí kopie týchž pravidel
-- v PL/pgSQL by se rozešla — třída „politiky mají tři domovy".
--
-- ⛔ JEDEN ŘÁDEK (`jedina`): instance má jednu deklaraci. Přístup jen service role
-- (RLS bez politik, žádné granty pro anon/authenticated); čtení i zápis přes RPC.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.zarizeni_deklarace (
  jedina       boolean     PRIMARY KEY DEFAULT true CHECK (jedina),
  deklarace    jsonb       NOT NULL CHECK (jsonb_typeof(deklarace) = 'object' AND deklarace ? 'applicationId'),
  zdroj_commit text        NULL,
  zapsano      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.zarizeni_deklarace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zarizeni_deklarace FROM PUBLIC, anon, authenticated;
