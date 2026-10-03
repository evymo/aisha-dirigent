-- Table: surface_scope_axes
-- RLS: ENABLED
--
-- OSY POHLEDU JSOU DATA (ADR-003 K5).
--
-- ⛔ NAMĚŘENO 2026-09-06: seznam os („čím smím omezit, na co se dívám") byl
-- konstantou v generickém shellu (`SCOPE_AXES` v App.tsx) a nesl JMÉNA VĚCÍ
-- jedné instance — `owner_company`, `unit_site`. Důsledek: v sanghě obě osy
-- vracely nula voleb, přepínač se vůbec nevykreslil, a každá nová instance by
-- si musela osu přidat editací forku. To je přesně zákon jmen naruby: jádro
-- zná druhy věcí, nikdy jména věcí.
--
-- ⭐ Řádek tady = jedna osa. Jméno osy i její substrát dodává OVERLAY instance;
-- jádro zná jen DRUHY substrátů (viz `get_scope_options`: twin_kind, relation,
-- label, template, twin, registry). Volby se pak ODVOZUJÍ z dat, neudržují se
-- v číselníku, který by se rozešel se skutečností.
--
-- `params` jde beze změny do `get_scope_options` (druh substrátu + jeho klíč).
-- `dim` je jméno parametru, pod kterým zvolená hodnota doputuje do bloků sekce
-- (`get_block_data(slug, {dim: value})`) — blok ji přijme jen tehdy, když ji
-- deklaruje ve `filters` a (u restricted) v `client_params` (K3).
-- `surfaces` omezuje osu na sekce; prázdné pole = všechny sekce.

create table if not exists public.surface_scope_axes (
  axis_key    text primary key
              check (axis_key ~ '^[a-z][a-z0-9_.]*$'),
  title_key   text not null check (length(title_key) > 0),
  dim         text not null check (dim ~ '^[a-z][a-z0-9_]*$'),
  params      jsonb not null default '{}'::jsonb
              check (jsonb_typeof(params) = 'object'),
  surfaces    jsonb not null default '[]'::jsonb
              check (jsonb_typeof(surfaces) = 'array'),
  audience    jsonb not null default '{}'::jsonb,
  namespace   text not null,
  position    integer not null default 0 check (position >= 0),
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.surface_scope_axes is
  'Declared axes of the view switcher (lens). One row = one axis; the instance overlay supplies its name and substrate, the kernel only knows substrate KINDS (see get_scope_options). Options are derived from data, never kept in a codebook.';

alter table public.surface_scope_axes enable row level security;
