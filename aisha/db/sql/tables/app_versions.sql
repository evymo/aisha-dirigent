create table if not exists public.app_versions (
    id uuid not null default gen_random_uuid(),
    platform text not null check (platform in ('ios', 'android')),
    min_version text not null default '1.0.0',
    latest_version text not null default '1.0.0',
    store_url text not null,
    maintenance_enabled boolean not null default false,
    maintenance_message text,
    maintenance_end timestamp with time zone,
    features jsonb not null default '{}'::jsonb,
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint app_versions_pkey primary key (id),
    constraint app_versions_platform_key unique (platform)
);

alter table public.app_versions enable row level security;

-- Policies moved to: supabase/sql/policies/app_versions__*.sql
