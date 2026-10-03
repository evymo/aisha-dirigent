-- Table: knock_device_credentials
-- RLS: ENABLED
--
-- Průkazy ZAŘÍZENÍ pro vrátného (VER 2) a jejich schválení.
--
-- ⭐ ZADÁNÍ MAJITELE (2026-09-09): „pokud uživatel na začátku zaklepe ručně
-- a pak se přihlásí, tak máme tím pádem spojenou informaci o tom, na koho je
-- vázán tablet a zda je to autorizované zařízení. […] zároveň pak víme, jaký
-- uživatel používá jaká zařízení."
--
-- Kořen důvěry je tedy RUČNÍ ZAKLEPÁNÍ ČLOVĚKEM. Teprve otevřenými dveřmi se
-- uživatel přihlásí a appka sem ohlásí svůj otisk — díky tomu má záznam
-- majitele, aniž by kdokoli cokoli opisoval nebo posílal.
--
-- ⛔⛔ DVOJČATA OBSAHEM, NE VÝZNAMEM (majitel, 2026-09-09): „je to kombinace
-- user-device a jsou to v jisté chvíli vlastně dvojčata, co se nesené informace
-- týká — ale každý má svůj vlastní význam: ťukání vs. posílání pushek."
--
-- `mobile_sessions` i tenhle průkaz popisují touž dvojici (uživatel, zařízení).
-- Splynout ale NESMÍ, protože každý odpovídá na jinou otázku:
--
--     knock_device_credentials  → SMÍ TO DOVNITŘ?      (dveře, autorizace)
--     mobile_sessions           → KAM TO DORUČIT?      (push, doručení)
--
-- Záměna je nebezpečná v OBOU směrech a ani v jednom není vidět:
--   · brát roster z `mobile_sessions` = pustit dovnitř každé zařízení, které si
--     jen vyzvedlo push token, tedy úplně bez schválení,
--   · posílat oznámení podle rosteru = neodeslat je zařízení, které schválené
--     (ještě) není, přestože právě ono na nový kód čeká.
-- Proto stojí vedle sebe a spojuje je jediný most: `push_device_id`.
--
-- ⛔ TADY SE NIC NEAUTORIZUJE. Zápis do téhle tabulky znamená jen „tohle
-- zařízení existuje a hlásí se k tomuhle uživateli". Dveře otevírá výhradně
-- roster vrátného, do kterého se dostane pouze SCHVÁLENÝ řádek.
--
-- ⛔ TABULKA NESMÍ NIKDY OBSAHOVAT SOUKROMÝ KLÍČ ANI SDÍLENÉ TAJEMSTVÍ.
-- Soukromá půlka zůstává v secure-store telefonu; to je celý smysl VER 2.
-- Kdyby sem někdo doplnil `hmac_key_hex`, server by držel tajemství, kterým se
-- dá za zařízení zaťukat, a `verify.ts` by takový roster odmítl jako vadný.
--
-- ⛔ `kid` JE ODVOZENÝ Z KLÍČE, ne vymyšlený (`kidZKlice` v @aisha/knock-protocol).
-- Proto je klíčem tabulky: jedno zařízení = jeden klíč = jedno jméno. Kdyby si
-- `kid` volilo zařízení, mohlo by vystupovat pod víc identitami a schválení by
-- ztratilo smysl — schvaluje se KLÍČ, ne jméno.

CREATE TABLE IF NOT EXISTS knock_device_credentials (
  kid text NOT NULL,
  -- SEC1 nekomprimovaný bod 0x04||X||Y = 65 B = 130 hex znaků. Kontrola tvaru
  -- patří i sem: špatný tvar by se jinak projevil až mlčením dveří.
  public_key_hex text NOT NULL,
  scope text NOT NULL,
  -- ⭐ KDO ZAŘÍZENÍ ZAVEDL, ne kdo ho používá. Používat ho po otevření dveří
  -- může kdokoli — dveře pracují na úrovni IP, ne identity.
  -- U průkazu TABLETU (druh = tablet) je NULL: tablet se ohlásí sám, bez
  -- přihlášeného člověka (viz `druh` níž).
  owner_user_id uuid,
  -- ⭐ DRUH PRŮKAZU (rozhodnutí majitele 2026-09-28): „po kliknutí na zavedení
  -- zařízení se klíč odešle na backend, protože je odemčeno, a následně to
  -- zařízení můžeme permanentně v administraci schválit, aby si tablet mohl
  -- ťukat sám bez zadávání kódu."
  --   osobni — ohlásila ho přihlášená appka člověka (register_knock_device),
  --   tablet — ohlásil se tablet v kiosku SÁM (enrol_kiosk_device přes bránu:
  --              jen z adresy, kterou právě otevřelo zaťukání, a jen s podpisem
  --              klíčem, který ohlašuje). Nic neschvaluje — schvaluje správce.
  druh text NOT NULL DEFAULT 'osobni',
  -- Odkud a s čím se tablet ohlásil — co správce vidí, než ho schválí.
  ohlaseno_z_ip inet,
  verze jsonb,
  -- ⭐ MOST K PUSH KANÁLU (zadání majitele 2026-09-09): „je třeba provázat to
  -- zařízení, abychom tomu zařízení-uživateli dokázali poslat push notifikaci —
  -- např. po odvolání kódu pro klepání zaslání nového jen těm oprávněným
  -- uživatelům, kteří ho mají dostat."
  --
  -- Je to `mobile_sessions.device_id` TÉHOŽ telefonu. Appka obě jména zná
  -- (otisk klíče i push id), takže most vzniká sám při ohlášení — nikdo nic
  -- nepáruje ručně.
  --
  -- ⛔ „KDO POUŽÍVÁ KTERÁ ZAŘÍZENÍ" SE SEM NEPÍŠE. Ta vazba UŽ EXISTUJE:
  -- `mobile_sessions` má `UNIQUE (device_id, user_id)`, tedy řádek na každou
  -- dvojici, a u něj rovnou push token. Druhý domov téhož faktu by se
  -- s prvním rozešel — stačí přes tenhle most připojit.
  --
  -- Nullable: průkaz může vzniknout dřív, než si appka vyzvedne push id
  -- (uživatel mohl notifikace odmítnout). Bez mostu se dá schvalovat, jen se
  -- nedá poslat oznámení — a to je pravdivější než vymyšlené id.
  push_device_id text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  -- Schválení. Dokud je `approved_at` NULL, je zařízení pro vrátného neznámé.
  approved_at timestamptz,
  approved_by uuid,
  -- Odvolání. Zůstává v tabulce (ne DELETE), aby bylo z čeho poznat, že
  -- zařízení kdysi schválené bylo — smazaný řádek vypadá jako „nikdy nebyl".
  revoked_at timestamptz,
  revoked_by uuid,
  -- F2: vlastní účet tabletu (aisha_auth.users). Zakládá ho JEN definer při schválení
  -- (zaloz_ucet_zarizeni_interni) a zapisuje ho SEM dřív, než vloží uživatele — podle
  -- téhle vazby handle_new_user pozná účet zařízení (příznak nese server, ne metadata,
  -- která může nastavit klient při registraci). FK je proto odložená.
  ucet_id uuid,
  -- Průkaz může mít konec platnosti (NULL = bez vypršení); pátá cesta viditelnosti ho
  -- kontroluje při KAŽDÉM volání, ne jen při vydání tokenu.
  plati_do timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kid),
  CONSTRAINT knock_device_credentials_pubkey_shape
    CHECK (public_key_hex ~ '^04[0-9a-f]{128}$'),
  -- ⛔ `kid` MUSÍ sedět na klíč. Bez téhle podmínky by schválený řádek mohl
  -- nést cizí jméno a vrátný by pod ním hledal jiný klíč, než jaký zařízení
  -- používá — a projevilo by se to `unknown-kid`, tedy mlčením.
  CONSTRAINT knock_device_credentials_kid_from_key
    CHECK (kid = 'dev-' || substring(public_key_hex from 3 for 16)),
  CONSTRAINT knock_device_credentials_scope_neprazdny
    CHECK (length(scope) > 0),
  CONSTRAINT knock_device_credentials_druh
    CHECK (druh IN ('osobni', 'tablet')),
  -- Osobní průkaz bez člověka by byl průkaz, který nikdo nezavedl.
  CONSTRAINT knock_device_credentials_vlastnik
    CHECK (druh = 'tablet' OR owner_user_id IS NOT NULL),
  CONSTRAINT knock_device_credentials_owner_fkey
    FOREIGN KEY (owner_user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT knock_device_credentials_ucet_jen_tablet
    CHECK (ucet_id IS NULL OR druh = 'tablet'),
  CONSTRAINT knock_device_credentials_ucet_fkey
    FOREIGN KEY (ucet_id) REFERENCES aisha_auth.users(id) DEFERRABLE INITIALLY DEFERRED
  -- ⛔ ŽÁDNÁ UNIKÁTNOST NA `push_device_id`. Když člověk zařízení zapomene a
  -- zavede znovu, vznikne NOVÝ `kid` na TÉMŽE telefonu — starý průkaz se
  -- odvolá (klíč k němu už neexistuje), ale řádek zůstane, aby bylo z čeho
  -- poznat, co bylo kdy schválené. Unikátní klíč by tenhle běžný úkon shodil.
);

ALTER TABLE knock_device_credentials ENABLE ROW LEVEL SECURITY;

-- ── Existující databáze → cílový stav (2026-09-28, průkaz tabletu) ───────────
-- Idempotentní: heals tenhle soubor přehrává při každém migrate.
ALTER TABLE public.knock_device_credentials ADD COLUMN IF NOT EXISTS druh text NOT NULL DEFAULT 'osobni';
-- F2 (2026-09-29): účet tabletu a platnost průkazu na už běžící DB.
ALTER TABLE public.knock_device_credentials ADD COLUMN IF NOT EXISTS ucet_id uuid;
ALTER TABLE public.knock_device_credentials ADD COLUMN IF NOT EXISTS plati_do timestamptz;
DO $f2$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knock_device_credentials_ucet_jen_tablet') THEN
    ALTER TABLE public.knock_device_credentials
      ADD CONSTRAINT knock_device_credentials_ucet_jen_tablet CHECK (ucet_id IS NULL OR druh = 'tablet');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knock_device_credentials_ucet_fkey') THEN
    ALTER TABLE public.knock_device_credentials
      ADD CONSTRAINT knock_device_credentials_ucet_fkey
      FOREIGN KEY (ucet_id) REFERENCES aisha_auth.users(id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $f2$;
ALTER TABLE public.knock_device_credentials ADD COLUMN IF NOT EXISTS ohlaseno_z_ip inet;
ALTER TABLE public.knock_device_credentials ADD COLUMN IF NOT EXISTS verze jsonb;
ALTER TABLE public.knock_device_credentials ALTER COLUMN owner_user_id DROP NOT NULL;
ALTER TABLE public.knock_device_credentials DROP CONSTRAINT IF EXISTS knock_device_credentials_druh;
ALTER TABLE public.knock_device_credentials
  ADD CONSTRAINT knock_device_credentials_druh CHECK (druh IN ('osobni', 'tablet'));
ALTER TABLE public.knock_device_credentials DROP CONSTRAINT IF EXISTS knock_device_credentials_vlastnik;
ALTER TABLE public.knock_device_credentials
  ADD CONSTRAINT knock_device_credentials_vlastnik CHECK (druh = 'tablet' OR owner_user_id IS NOT NULL);
