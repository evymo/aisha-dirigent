-- ============================================================================
-- Source of Truth: federated_source_sessions
-- Popis: Trezor relací uživatelů u federovaného zdroje (ADR-004).
--
-- Řádek = relace JEDNOHO uživatele aishy u JEDNOHO zdroje: token, kterým broker
-- volá zdroj JAKO TEN UŽIVATEL. Heslo se neukládá nikdy.
--
-- ⛔ ŠIFRUJE BROKER, NE DATABÁZE. `token_ct` / `refresh_ct` jsou AES-256-GCM
-- s klíčem FEDERATION_VAULT_KEY, který žije jen v tajemstvích brokeru (key_id pro
-- rotaci; AAD váže šifrový text na provider | user_id | id relace). Databáze drží
-- jen neprůhledné bajty. Důvod: obecné `aisha_decrypt_column_audited` je granted
-- authenticated a pouští admin/staff, a klíče sloupců i trezoru jsou v DB jako GUC
-- (`ALTER DATABASE … SET`, `PGOPTIONS`), tedy čitelné relacemi se SQL. Klíč v DB
-- by token nechránil.
--
-- ⛔ BEZ CIZÍHO KLÍČE na aisha_auth.users. Token u zdroje bez expirace platí,
-- dokud ho někdo výslovně neodhlásí. CASCADE by při smazání uživatele zahodil
-- šifrový text i evidenci — a token by u zdroje žil navždy. Relace smazaného
-- uživatele odvolá a odhlásí `federated_source_session_logout_due`.
--
-- Odvolání: `revoked_at` + `revoke_reason`; odhlášení u zdroje je fronta nad
-- týmiž řádky (`logout_done_at IS NULL`), zpracovává ji plánovač brokeru. Po
-- odhlášení se šifrový text maže (`token_ct` = prázdné bajty).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.federated_source_sessions (
  id               uuid PRIMARY KEY,
  user_id          uuid NOT NULL,
  provider         text NOT NULL,
  provider_id      text NOT NULL,
  token_ct         bytea NOT NULL,
  refresh_ct       bytea,
  key_id           text NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  expires_at       timestamptz NOT NULL,
  verified_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  revoke_reason    text,
  logout_done_at   timestamptz,
  logout_attempts  integer NOT NULL DEFAULT 0,
  logout_next_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT federated_source_sessions_provider_nonempty CHECK (length(btrim(provider)) > 0),
  CONSTRAINT federated_source_sessions_provider_id_nonempty CHECK (length(btrim(provider_id)) > 0),
  CONSTRAINT federated_source_sessions_key_id_nonempty CHECK (length(btrim(key_id)) > 0),
  CONSTRAINT federated_source_sessions_version_positive CHECK (version >= 1),
  CONSTRAINT federated_source_sessions_logout_jen_odvolana CHECK (revoked_at IS NOT NULL OR logout_done_at IS NULL)
);

COMMENT ON TABLE public.federated_source_sessions IS
  'Trezor relací uživatelů u federovaného zdroje (ADR-004). Šifruje broker (AES-256-GCM, klíč mimo DB). Čte jen servisní role přes SECURITY DEFINER funkce.';

-- RLS v souboru TABULKY (brána production-build): bez ní by tabulka byla čitelná
-- od vzniku do doběhnutí rls/.
ALTER TABLE public.federated_source_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.federated_source_sessions FROM PUBLIC, anon, authenticated;
