-- Table: invitations
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  created_by uuid NOT NULL,
  email text,
  role text,
  study_id uuid,
  -- ⭐ KOHO POZVÁNKA SPÁŘÍ (2026-09-10). Ingest identifikuje OSOBU (twin), ale
  -- účet jí zpravidla ještě nepatří — právě proto se posílá pozvánka. Jakmile
  -- ji člověk uplatní, je z uplatnění poznat, KTERÝM účtem, a vazba twin↔účet
  -- vznikne z úkonu, který ten člověk sám udělal.
  --
  -- ⛔ NENÍ TO V `metadata`. Důsledky pozvánky jsou v téhle tabulce typované
  -- sloupce s cizím klíčem (`role`, `study_id`) — a je to tak proto, že řetězec
  -- v jsonb může ukazovat na smazaný twin a nikdo se to nedozví.
  --
  -- ⭐ TÍMHLE SE OBCHÁZÍ MEZERA, KTEROU NEJDE ZAVŘÍT JINAK: `wd_drivers` (zdroj
  -- identity řidičů) NEMÁ e-mail, takže spárovat twin s účtem automaticky se
  -- nedá — jediný společný silný klíč s `profiles` je telefon, a ten stačí na
  -- návrh, ne na jistotu. Pozvánka to řeší od jiného konce: nehádá se, kdo to
  -- je, ale pošle se to ADRESNĚ a člověk se prokáže sám.
  twin_id uuid,
  max_uses int4 DEFAULT 1,
  used_count int4 DEFAULT 0,
  expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  is_active bool DEFAULT true,
  prefill_first_name text,
  prefill_last_name text,
  prefill_phone text,
  prefill_notes text,
  PRIMARY KEY (id),
  CONSTRAINT invitations_code_key UNIQUE (code),
  CONSTRAINT invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id) ON DELETE CASCADE,
  CONSTRAINT invitations_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL,
  -- SET NULL jako u `study_id`: smazání twinu nesmí odstranit pozvánku ani
  -- historii jejího uplatnění — jen přestane mít koho spářit.
  CONSTRAINT invitations_twin_id_fkey FOREIGN KEY (twin_id) REFERENCES twin_entities(id) ON DELETE SET NULL
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Grants: invitation management
-- NO anon SELECT (audit C2): the table carries invite code + intended role +
-- email/PII; RLS filters rows not columns, so a table grant would let an
-- unauthenticated PostgREST client enumerate every live invite. Registration
-- reads go through the SECURITY DEFINER validate_invitation RPC instead.
GRANT SELECT, INSERT, UPDATE ON invitations TO authenticated;
GRANT ALL ON invitations TO service_role;

-- ⛔ `CREATE TABLE IF NOT EXISTS` VÝŠ JE NA EXISTUJÍCÍ TABULCE NO-OP, takže by
-- se nový sloupec na živou databázi NIKDY nedostal — projevilo by se to jako
-- „pozvánky s twinem nefungují", a to až v provozu. Sloupec i cizí klíč se
-- proto dodávají zvlášť, idempotentně (heals běží při každém migrate).
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS twin_id uuid;

DO $$
BEGIN
  -- Cizí klíč nemá `IF NOT EXISTS`, takže se hlídá katalogem. Bez něj by
  -- `twin_id` mohl ukazovat na smazaný twin a nikdo by se to nedozvěděl.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'invitations_twin_id_fkey'
       AND conrelid = 'public.invitations'::regclass
  ) THEN
    ALTER TABLE public.invitations
      ADD CONSTRAINT invitations_twin_id_fkey
      FOREIGN KEY (twin_id) REFERENCES public.twin_entities(id) ON DELETE SET NULL;
  END IF;
END
$$;
