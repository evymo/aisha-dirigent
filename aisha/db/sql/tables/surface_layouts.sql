-- Přiřazení bloků na surface + pořadí. Řádky = instance data.

create table if not exists public.surface_layouts (
  id         uuid primary key default gen_random_uuid(),
  -- Sekce extranetu (ask, workflow, registry, workbench, porada, …) — NE zařízení.
  -- Otevřený text ZÁMĚRNĚ: které sekce existují, co obsahují a v jakém pořadí je
  -- DATA, která servíruje backend. Nová sekce = řádek, ne migrace a ne release
  -- klienta. Táž konvence jako `ide_sessions.source`.
  --
  -- Uzavřený výčet tu byl a stál nás to: 'porada' šla do CHECKu ALTERem mimo SoT,
  -- takže repo znalo 3 hodnoty a živá DB 4. Zároveň se zařízení pletlo se sekcí,
  -- takže se tytéž bloky duplikovaly per web/mobile — a 'porada' skončila
  -- definovaná dvakrát (kurátorovaný web layout + podmnožina propašovaná do
  -- 'mobile'), přičemž mobilní obrazovka porady nezobrazila ani jednu.
  -- Přizpůsobení zařízení je práce rendereru, ne osa téhle tabulky.
  --
  -- Uzavřený zůstává `surface_blocks.block_type` — ten pojmenovává renderer.
  -- ⛔ POJMENOVANÉ, ne anonymní (2026-08-25). Anonymní check si Postgres pojmenuje
  -- sám (`surface_layouts_surface_check`), jenže heals.sql ho od 2026-08-17
  -- přejmenovává na `surface_layouts_surface_nonempty`. Dvě cesty upgradu tím
  -- končily u schémat, která se liší JMÉNEM omezení při shodné podmínce —
  -- přesně to, co db-convergence-schema-equivalence hlídá. Nevšiml si toho nikdo
  -- osm dní, protože ta brána je DB-REQUIRING a v offline `test:gates` se
  -- PŘESKAKUJE; běží jen pod throwaway-DB harnessem.
  surface    text not null constraint surface_layouts_surface_nonempty check (length(surface) > 0),
  block_id   uuid not null references public.surface_blocks(id) on delete cascade,
  -- Publikum: dnes tier-based model (audience_user_meets_tier_requirement); po Sprint 3.7
  -- namespace ACL. Vyhodnocení se doplní do RLS/RPC — sloupec drží deklaraci.
  audience   jsonb not null default '{}'::jsonb,
  position   integer not null default 0 check (position >= 0),
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (surface, block_id)
);

comment on table public.surface_layouts is
  'Per-surface block placement and ordering. Rows are instance data.';

ALTER TABLE public.surface_layouts ENABLE ROW LEVEL SECURITY;
