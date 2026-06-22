-- Sinbad Core v0.1 — Passive Identity Minter
-- Migration 0001: identity table, audit log, settings (kill-switch)
--
-- Scope guardrails (do not extend in v0.1):
--   * Sinbad ID is neutral, internal, permanent, and never reused.
--   * shopify_customer_id is the ONLY automatic matching anchor.
--   * email/phone are stored ONLY as weak signals (never matched on).
--   * No wallet/coins/rewards/levels/etc. No guest handling. No merges.

-- ---------------------------------------------------------------------------
-- core_identity: the permanent neutral identity and its Shopify link
-- ---------------------------------------------------------------------------
create table if not exists public.core_identity (
    -- Neutral, internal, permanent identifier. Generated, never recycled.
    sinbad_id            uuid        primary key default gen_random_uuid(),

    -- The only automatic matching anchor in v0.1. One identity per Shopify customer.
    shopify_customer_id  text        not null unique,

    -- Weak signals ONLY. Stored for future deliberate matching; never auto-matched.
    email_signal         text,
    phone_signal         text,

    -- Arabic/English ready from day one.
    language_preference  text        not null default 'en'
                                     check (language_preference in ('ar', 'en')),

    -- Logged-in customers are 'confirmed'. Room reserved for future statuses.
    status               text        not null default 'confirmed',

    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- core_identity_audit: append-only record of mint/reuse decisions
-- ---------------------------------------------------------------------------
create table if not exists public.core_identity_audit (
    id                   bigint      generated always as identity primary key,
    sinbad_id            uuid        not null,
    shopify_customer_id  text        not null,
    action               text        not null check (action in ('minted', 'reused')),
    -- Privacy: store presence flags, not the raw signals (kept in core_identity).
    detail               jsonb       not null default '{}'::jsonb,
    created_at           timestamptz not null default now()
);

create index if not exists core_identity_audit_sinbad_id_idx
    on public.core_identity_audit (sinbad_id);
create index if not exists core_identity_audit_shopify_customer_id_idx
    on public.core_identity_audit (shopify_customer_id);

-- ---------------------------------------------------------------------------
-- core_settings: simple key/value config, home of the kill-switch
-- ---------------------------------------------------------------------------
create table if not exists public.core_settings (
    key         text        primary key,
    value       jsonb       not null,
    updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists core_identity_set_updated_at on public.core_identity;
create trigger core_identity_set_updated_at
    before update on public.core_identity
    for each row execute function public.set_updated_at();

drop trigger if exists core_settings_set_updated_at on public.core_settings;
create trigger core_settings_set_updated_at
    before update on public.core_settings
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access boundary: RLS enabled with NO policies.
-- Tables are unreachable by anon/authenticated. Only the backend
-- (service role, which bypasses RLS) reaches them via the observe function.
-- ---------------------------------------------------------------------------
alter table public.core_identity        enable row level security;
alter table public.core_identity_audit  enable row level security;
alter table public.core_settings        enable row level security;
