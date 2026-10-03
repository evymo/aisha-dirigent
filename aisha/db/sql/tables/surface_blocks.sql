-- Surface-agnostické datové bloky (view-model kontrakt @aisha/surface-blocks, schema_version 1).
-- Řádky = instance data; platforma nedodává žádný default obsah (ships empty & functional).

create table if not exists public.surface_blocks (
  id             uuid primary key default gen_random_uuid(),
  block_slug     text not null unique
                 check (block_slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  -- Block-type vocabulary is a TRIPLE that must move in lockstep:
  --   packages/surface-blocks/src/types.ts (BlockType union)
  --   packages/surface-blocks/src/schemas.ts (Ajv anyOf + layout enum)
  --   this CHECK. A parity smoke test guards the three.
  block_type     text not null
                 check (block_type in ('kpi_tile','chart','table','timeline','alert_feed','narrative',
                                       'record_detail','review_queue','findings','goal_progress','timing_tower',
                                       'handover_confirm','action_form','relation_web')),
  -- i18n klíč (key-first) — nikdy literál k zobrazení
  title_key      text not null check (length(title_key) > 0),
  -- zdroj dat: POUZE jméno z allowlistu (dispatcher vynucuje i za běhu)
  source_rpc     text not null references public.surface_data_rpcs(rpc_name),
  source_params  jsonb not null default '{}'::jsonb,
  namespace      text not null,  -- konzistentní s agent_knowledge_sources namespace konceptem
  -- 4D klasifikace (Source Onboarding Contract)
  sensitivity    text not null
                 check (sensitivity in ('public','internal','restricted','confidential')),
  schema_version integer not null default 1 check (schema_version >= 1),
  is_active      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- updated_at drží trigger v triggers/surface_blocks_updated_at.sql (public.set_updated_at()).

comment on table public.surface_blocks is
  'Surface-agnostic block definitions (kpi_tile/table/timeline/alert_feed/narrative). Rows are instance data.';

ALTER TABLE public.surface_blocks ENABLE ROW LEVEL SECURITY;
