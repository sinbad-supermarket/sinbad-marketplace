-- Sinbad Core v0.2 — Shopify OAuth connection
-- Stores one server-side Shopify Admin API OAuth connection for the Sinbad store.
-- No Shopify catalog behavior is added here.

create table if not exists public.shopify_oauth_states (
    state_hash text primary key,
    shop_domain text not null,
    redirect_uri text not null,
    status text not null default 'pending'
        check (status in ('pending', 'used', 'expired')),
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    used_at timestamptz
);

create table if not exists public.shopify_connections (
    id uuid primary key default gen_random_uuid(),
    shop_domain text not null unique,
    app_client_id text not null,
    access_token_ciphertext text not null,
    access_token_iv text not null,
    scopes text[] not null default '{}',
    status text not null default 'active'
        check (status in ('active', 'revoked', 'error')),
    shop_name text,
    shopify_shop_id text,
    app_installation_id text,
    app_id text,
    app_title text,
    connected_by uuid references auth.users(id),
    connected_at timestamptz not null default now(),
    last_preflight_at timestamptz,
    last_preflight_status text,
    last_preflight_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists shopify_oauth_states_status_expires_at_idx
    on public.shopify_oauth_states (status, expires_at);

create index if not exists shopify_oauth_states_created_by_idx
    on public.shopify_oauth_states (created_by);

create index if not exists shopify_connections_status_idx
    on public.shopify_connections (status);

create trigger set_shopify_connections_updated_at
    before update on public.shopify_connections
    for each row
    execute function public.set_updated_at();

alter table public.shopify_oauth_states enable row level security;
alter table public.shopify_connections enable row level security;

revoke all on table public.shopify_oauth_states from public, anon, authenticated;
revoke all on table public.shopify_connections from public, anon, authenticated;

grant select, insert, update, delete on table public.shopify_oauth_states to service_role;
grant select, insert, update, delete on table public.shopify_connections to service_role;
