-- ============================================================================
-- Source of Truth: agent_knowledge_source_secrets
-- Popis: Pověření ke zdroji dat — ŠIFROVANĚ a mimo `config`.
--
-- ⛔ PROČ VLASTNÍ TABULKA A NE SLOUPEC V `config`
-- `agent_knowledge_sources.config` je čitelná jsonb, kterou administrace
-- zobrazuje a `list_*` funkce vracejí. Heslo v ní by bylo heslo na obrazovce.
-- Naměřeno 2026-09-01: zdroje `tcars-fleet`, `webdispecink-fleet`
-- a `eurowag-telematics` mají ve svém `config_schema` po TŘECH polích
-- označených `secret: true` — a v platformě neexistovalo místo, kam je uložit.
--
-- ⭐ JEDEN ŘÁDEK = JEDEN KLÍČ. Ne jeden blob: takhle jde ZJISTIT, které klíče
-- jsou vyplněné, aniž se cokoli dešifruje. Přesně to potřebuje jak formulář
-- v administraci, tak stráž v `activate_data_source`.
--
-- ⛔ HODNOTA JE `bytea` A NIKDY SE NEVRACÍ. Šifruje `aisha_encrypt_column_audited`,
-- čte výhradně SECURITY DEFINER funkce. Nad tabulkou je RLS BEZ jediné
-- povolující policy — tedy „nikdo", ne „skoro nikdo".
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_knowledge_source_secrets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL
                 REFERENCES public.agent_knowledge_sources(id) ON DELETE CASCADE,
  secret_key   text NOT NULL,
  value_enc    bytea NOT NULL,
  set_by       uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_knowledge_source_secrets_key_nonempty
    CHECK (length(btrim(secret_key)) > 0),
  CONSTRAINT agent_knowledge_source_secrets_unique
    UNIQUE (source_id, secret_key)
);

COMMENT ON TABLE public.agent_knowledge_source_secrets IS
  'Šifrovaná pověření ke zdroji dat. Jeden řádek = jeden klíč, aby šlo zjistit PŘÍTOMNOST bez dešifrování. Hodnota se nikdy nevrací ven.';

-- RLS i tady: brána `production-build` ji vyžaduje v souboru TABULKY, protože
-- tabulka bez ní by byla čitelná od chvíle vzniku do chvíle, než doběhne `rls/`.
ALTER TABLE public.agent_knowledge_source_secrets ENABLE ROW LEVEL SECURITY;
