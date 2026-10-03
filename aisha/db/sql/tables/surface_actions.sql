-- Table: surface_actions
-- ============================================================================
-- AKCE JAKO DATA (ADR-003, program K4). Zrcadlo allowlistu čtení
-- (surface_data_rpcs → get_block_data): řádek tady je JEDINÝ způsob, jak se
-- z plochy zavolá zápisové RPC. Klient nikdy neposílá jméno funkce — posílá
-- `action_slug`, cíl a payload; submit_surface_action slug přeloží,
-- payload ověří proti deklaraci `fields`, argumenty složí podle `arg_map`
-- (pojmenované argumenty, hodnoty jako literály) a zapíše audit.
--
-- Maska `action_form` (uzavřená, jeden renderer v každém klientovi) kreslí to,
-- co get_surface_actions_block vydá z těchto řádků — jaké akce, s jakými poli.
-- Nová akce = ŘÁDEK v instančním overlayi, ne release klienta.
--
-- Sloupce:
--   action_slug   identita akce (`followup.create`, `tag.add`, …)
--   title_key     i18n klíč tlačítka; description_key volitelný popis
--   target_kind   nad čím akce běží: 'twin' | 'actor' | 'story' | 'none'
--                 (cíl posílá klient; server ho ověří a doplní odvozené hodnoty:
--                 twin → user_id přes potvrzenou referenci účtu, actor → twin_id)
--   rpc_name      zápisové RPC, které se zavolá (identifikátor, CHECK)
--   arg_map       [{name, from, type, key?, value?, fallback?, required?}]
--                 from ∈ target.twin_id | target.user_id | target.user_ids |
--                        target.story_id | caller.user_id | payload | payload_json | const
--                 type ∈ uuid|text|timestamptz|date|integer|boolean|numeric|jsonb|uuid[]|text[]
--   fields        [{key, label_key, type, required?, options?[{value,label_key}], default?}]
--                 type ∈ text|textarea|uuid|date|timestamptz|integer|boolean|enum
--   returns_void  RPC vrací void (nelze to_jsonb) → volá se bez návratu
--   audience      {} | {"roles":[…]} | {"min_tier":…} — kdo akci VIDÍ a smí ji
--                 odeslat (surface_audience_allows); vlastní autorizaci zápisu
--                 drží cílové RPC (is_admin_or_staff, adresát taktu, …) — tady
--                 je jen viditelnost tlačítka, ne hranice dat
--   namespace     vlastník řádku (konvergence per overlay), sensitivity, position
-- ============================================================================
create table if not exists public.surface_actions (
  action_slug     text primary key
                  check (action_slug ~ '^[a-z][a-z0-9_.]*$'),
  title_key       text not null check (length(title_key) > 0),
  description_key text,
  target_kind     text not null default 'none'
                  check (target_kind in ('twin','actor','story','none')),
  rpc_name        text not null check (rpc_name ~ '^[a-z][a-z0-9_]*$'),
  arg_map         jsonb not null default '[]'::jsonb check (jsonb_typeof(arg_map) = 'array'),
  fields          jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array'),
  returns_void    boolean not null default false,
  audience        jsonb not null default '{}'::jsonb,
  namespace       text not null,
  sensitivity     text not null default 'restricted'
                  check (sensitivity in ('public','internal','restricted','confidential')),
  position        integer not null default 0 check (position >= 0),
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.surface_actions is
  'Allowlist of WRITE actions callable from a surface via submit_surface_action. Actions are data (instance overlay); the client only sends action_slug + target + payload. No dynamic RPC names outside this table.';

alter table public.surface_actions enable row level security;
