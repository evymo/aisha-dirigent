-- Publikované podepsané read-only snímky (Ed25519). CHECK vynucuje offline cap:
-- confidential se do snímku NIKDY nedostane (fail-closed už na zápisu, parita s emitorem,
-- který při bloku > restricted ABORTUJE — žádné tiché stripování).

create table if not exists public.surface_snapshots (
  id               uuid primary key default gen_random_uuid(),
  snapshot_slug    text not null check (snapshot_slug ~ '^[a-z0-9][a-z0-9_-]*$'),
  -- Sekce, ne zařízení — otevřený text, viz surface_layouts.surface. Uzavřený
  -- výčet tu znamenal, že pro 'porada' NEŠLO snímek vůbec podepsat.
  -- Bezpečnostní hranicí snímku je max_sensitivity níže, ne jméno sekce.
  -- Pojmenované, ne anonymní — týž důvod jako u surface_layouts.surface:
  -- heals.sql omezení přejmenovává, takže anonymní jméno rozchází baseline
  -- s reconcile cestou (viz komentář tam).
  surface          text not null constraint surface_snapshots_surface_nonempty check (length(surface) > 0),
  -- payload = SnapshotEnvelope (schema @aisha/surface-blocks snapshot/v1) BEZ podpisových polí
  payload          jsonb not null,
  max_sensitivity  text not null
                   check (max_sensitivity in ('public','internal','restricted')),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  signature        text not null check (length(signature) > 0),  -- base64url Ed25519
  key_id           text not null check (length(key_id) > 0),
  published_at     timestamptz not null default now(),
  expires_at       timestamptz not null,
  check (expires_at > published_at)
);

comment on table public.surface_snapshots is
  'Signed read-only snapshots for offline surfaces. max_sensitivity capped at restricted BY CHECK.';

ALTER TABLE public.surface_snapshots ENABLE ROW LEVEL SECURITY;
