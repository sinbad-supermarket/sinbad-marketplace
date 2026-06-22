-- Sinbad Core v0.2 — Multi-Vendor Foundation
-- Migration 0003: admin role resolution + vendor schema foundation
--
-- Scope guardrails:
--   * Schema only. No Shopify publishing, webhook ingestion, dashboard, or UI.
--   * Do not modify v0.1 identity tables.
--   * Every vendor-owned operational row is explicitly scoped by vendor_id.
--   * Each product belongs to exactly one vendor.
--   * Vendor Live pinned products must belong to the same vendor as the session.
--   * RLS is enabled with no broad public policies.

-- ---------------------------------------------------------------------------
-- admin_users: Sinbad Admin role resolution for RLS/admin checks
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
    id          uuid        primary key default gen_random_uuid(),
    user_id     uuid        not null unique references auth.users(id) on delete cascade,
    role        text        not null check (role in ('owner', 'admin', 'reviewer', 'finance')),
    active      boolean     not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vendors: canonical vendor account
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
    id                       uuid        primary key default gen_random_uuid(),
    name                     text        not null,
    slug                     text        not null unique,
    status                   text        not null default 'draft'
                                               check (status in ('draft', 'active', 'suspended', 'archived')),
    default_commission_rate  numeric(7,4) not null default 0
                                               check (default_commission_rate >= 0 and default_commission_rate <= 1),
    shopify_collection_id    text,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vendor_users: maps Supabase Auth users to vendors
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_users (
    id          uuid        primary key default gen_random_uuid(),
    vendor_id   uuid        not null references public.vendors(id) on delete cascade,
    user_id     uuid        not null references auth.users(id) on delete cascade,
    role        text        not null check (role in ('owner', 'staff')),
    status      text        not null default 'active'
                                      check (status in ('active', 'invited', 'suspended')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (vendor_id, user_id)
);

-- ---------------------------------------------------------------------------
-- vendor_product_submissions: vendor-authored product drafts and review queue
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_product_submissions (
    id                  uuid        primary key default gen_random_uuid(),
    vendor_id           uuid        not null references public.vendors(id) on delete restrict,
    submitted_by        uuid        references auth.users(id) on delete set null,
    title               text        not null,
    description         text,
    images              jsonb       not null default '[]'::jsonb,
    price               numeric(12,3) check (price is null or price >= 0),
    sku                 text,
    inventory_quantity  integer     check (inventory_quantity is null or inventory_quantity >= 0),
    status              text        not null default 'draft'
                                            check (status in (
                                                'draft',
                                                'submitted',
                                                'under_review',
                                                'approved',
                                                'rejected',
                                                'published',
                                                'archived'
                                            )),
    review_notes        text,
    reviewed_by         uuid        references auth.users(id) on delete set null,
    reviewed_at         timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (id, vendor_id)
);

-- ---------------------------------------------------------------------------
-- vendor_products: approved/published vendor-owned products mapped to Shopify
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_products (
    id                  uuid        primary key default gen_random_uuid(),
    vendor_id           uuid        not null references public.vendors(id) on delete restrict,
    submission_id       uuid        not null unique,
    shopify_product_id  text,
    shopify_variant_id  text,
    title               text        not null,
    status              text        not null default 'approved'
                                            check (status in ('approved', 'publishing', 'published', 'unpublished', 'archived')),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (id, vendor_id),
    unique (vendor_id, shopify_product_id),
    foreign key (submission_id, vendor_id)
        references public.vendor_product_submissions(id, vendor_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- vendor_orders: vendor-scoped attribution from Shopify orders
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_orders (
    id                     uuid        primary key default gen_random_uuid(),
    vendor_id              uuid        not null references public.vendors(id) on delete restrict,
    shopify_order_id       text        not null,
    shopify_order_number   text,
    core_identity_id       uuid        references public.core_identity(sinbad_id) on delete set null,
    customer_email_signal  text,
    currency               text,
    subtotal               numeric(12,3) check (subtotal is null or subtotal >= 0),
    commission_total       numeric(12,3) check (commission_total is null or commission_total >= 0),
    status                 text        not null default 'pending'
                                               check (status in ('pending', 'fulfilled', 'cancelled', 'refunded', 'partially_refunded')),
    ordered_at             timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    unique (id, vendor_id),
    unique (vendor_id, shopify_order_id)
);

-- ---------------------------------------------------------------------------
-- vendor_order_items: per-line-item vendor attribution
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_order_items (
    id                    uuid        primary key default gen_random_uuid(),
    vendor_order_id       uuid        not null,
    vendor_id             uuid        not null references public.vendors(id) on delete restrict,
    vendor_product_id     uuid,
    shopify_line_item_id  text        not null,
    shopify_product_id    text,
    shopify_variant_id    text,
    quantity              integer     not null check (quantity > 0),
    unit_price            numeric(12,3) not null check (unit_price >= 0),
    line_subtotal         numeric(12,3) not null check (line_subtotal >= 0),
    commission_rate       numeric(7,4) check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 1)),
    commission_amount     numeric(12,3) check (commission_amount is null or commission_amount >= 0),
    created_at            timestamptz not null default now(),
    unique (id, vendor_id),
    unique (vendor_order_id, shopify_line_item_id),
    foreign key (vendor_order_id, vendor_id)
        references public.vendor_orders(id, vendor_id) on delete cascade,
    foreign key (vendor_product_id, vendor_id)
        references public.vendor_products(id, vendor_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- vendor_commissions: commission lifecycle per line item
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_commissions (
    id                    uuid        primary key default gen_random_uuid(),
    vendor_id             uuid        not null references public.vendors(id) on delete restrict,
    vendor_order_item_id  uuid        not null unique,
    rate                  numeric(7,4) not null check (rate >= 0 and rate <= 1),
    amount                numeric(12,3) not null check (amount >= 0),
    status                text        not null default 'pending'
                                              check (status in ('pending', 'approved', 'paid', 'void')),
    approved_by           uuid        references auth.users(id) on delete set null,
    approved_at           timestamptz,
    paid_at               timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    foreign key (vendor_order_item_id, vendor_id)
        references public.vendor_order_items(id, vendor_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- vendor_live_sessions: vendor live commerce session
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_live_sessions (
    id          uuid        primary key default gen_random_uuid(),
    vendor_id   uuid        not null references public.vendors(id) on delete cascade,
    title       text        not null,
    status      text        not null default 'draft'
                                      check (status in ('draft', 'scheduled', 'live', 'ended', 'cancelled')),
    starts_at   timestamptz,
    ended_at    timestamptz,
    created_by  uuid        references auth.users(id) on delete set null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (id, vendor_id)
);

-- ---------------------------------------------------------------------------
-- vendor_live_session_products: pinned products for live sessions
--
-- Composite foreign keys enforce the same-vendor rule:
--   * live_session_id + vendor_id must point to that vendor's session
--   * vendor_product_id + vendor_id must point to that vendor's product
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_live_session_products (
    id                 uuid        primary key default gen_random_uuid(),
    live_session_id    uuid        not null,
    vendor_id          uuid        not null,
    vendor_product_id  uuid        not null,
    position           integer     not null default 0 check (position >= 0),
    created_at         timestamptz not null default now(),
    unique (live_session_id, vendor_product_id),
    unique (live_session_id, position),
    foreign key (live_session_id, vendor_id)
        references public.vendor_live_sessions(id, vendor_id) on delete cascade,
    foreign key (vendor_product_id, vendor_id)
        references public.vendor_products(id, vendor_id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- vendor_audit_logs: immutable vendor/admin action history
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_audit_logs (
    id             bigint      generated always as identity primary key,
    vendor_id      uuid        references public.vendors(id) on delete set null,
    actor_user_id  uuid        references auth.users(id) on delete set null,
    actor_type     text        not null check (actor_type in ('sinbad_admin', 'vendor_owner', 'vendor_staff', 'service_role', 'system')),
    action         text        not null,
    entity_type    text        not null,
    entity_id      uuid,
    metadata       jsonb       not null default '{}'::jsonb,
    created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions for future RLS policies
-- ---------------------------------------------------------------------------
create or replace function public.is_sinbad_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
          and active = true
    );
$$;

create or replace function public.current_user_vendor_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(array_agg(vendor_id), '{}'::uuid[])
    from public.vendor_users
    where user_id = auth.uid()
      and status = 'active';
$$;

revoke all on function public.is_sinbad_admin() from public;
revoke all on function public.current_user_vendor_ids() from public;
grant execute on function public.is_sinbad_admin() to authenticated, service_role;
grant execute on function public.current_user_vendor_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at
    before update on public.admin_users
    for each row execute function public.set_updated_at();

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
    before update on public.vendors
    for each row execute function public.set_updated_at();

drop trigger if exists vendor_users_set_updated_at on public.vendor_users;
create trigger vendor_users_set_updated_at
    before update on public.vendor_users
    for each row execute function public.set_updated_at();

drop trigger if exists vendor_product_submissions_set_updated_at on public.vendor_product_submissions;
create trigger vendor_product_submissions_set_updated_at
    before update on public.vendor_product_submissions
    for each row execute function public.set_updated_at();

drop trigger if exists vendor_products_set_updated_at on public.vendor_products;
create trigger vendor_products_set_updated_at
    before update on public.vendor_products
    for each row execute function public.set_updated_at();

drop trigger if exists vendor_orders_set_updated_at on public.vendor_orders;
create trigger vendor_orders_set_updated_at
    before update on public.vendor_orders
    for each row execute function public.set_updated_at();

drop trigger if exists vendor_commissions_set_updated_at on public.vendor_commissions;
create trigger vendor_commissions_set_updated_at
    before update on public.vendor_commissions
    for each row execute function public.set_updated_at();

drop trigger if exists vendor_live_sessions_set_updated_at on public.vendor_live_sessions;
create trigger vendor_live_sessions_set_updated_at
    before update on public.vendor_live_sessions
    for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists admin_users_user_id_idx
    on public.admin_users (user_id);
create index if not exists admin_users_active_idx
    on public.admin_users (active);

create index if not exists vendors_status_idx
    on public.vendors (status);
create index if not exists vendors_slug_idx
    on public.vendors (slug);

create index if not exists vendor_users_vendor_id_idx
    on public.vendor_users (vendor_id);
create index if not exists vendor_users_user_id_idx
    on public.vendor_users (user_id);
create index if not exists vendor_users_status_idx
    on public.vendor_users (status);

create index if not exists vendor_product_submissions_vendor_id_idx
    on public.vendor_product_submissions (vendor_id);
create index if not exists vendor_product_submissions_status_idx
    on public.vendor_product_submissions (status);
create index if not exists vendor_product_submissions_submitted_by_idx
    on public.vendor_product_submissions (submitted_by);
create index if not exists vendor_product_submissions_reviewed_by_idx
    on public.vendor_product_submissions (reviewed_by);
create index if not exists vendor_product_submissions_vendor_id_status_idx
    on public.vendor_product_submissions (vendor_id, status);

create index if not exists vendor_products_vendor_id_idx
    on public.vendor_products (vendor_id);
create index if not exists vendor_products_status_idx
    on public.vendor_products (status);
create index if not exists vendor_products_shopify_product_id_idx
    on public.vendor_products (shopify_product_id);
create index if not exists vendor_products_shopify_variant_id_idx
    on public.vendor_products (shopify_variant_id);

create index if not exists vendor_orders_vendor_id_idx
    on public.vendor_orders (vendor_id);
create index if not exists vendor_orders_shopify_order_id_idx
    on public.vendor_orders (shopify_order_id);
create index if not exists vendor_orders_core_identity_id_idx
    on public.vendor_orders (core_identity_id);
create index if not exists vendor_orders_status_idx
    on public.vendor_orders (status);
create index if not exists vendor_orders_ordered_at_idx
    on public.vendor_orders (ordered_at);
create index if not exists vendor_orders_vendor_id_status_idx
    on public.vendor_orders (vendor_id, status);

create index if not exists vendor_order_items_vendor_order_id_idx
    on public.vendor_order_items (vendor_order_id);
create index if not exists vendor_order_items_vendor_id_idx
    on public.vendor_order_items (vendor_id);
create index if not exists vendor_order_items_vendor_product_id_idx
    on public.vendor_order_items (vendor_product_id);
create index if not exists vendor_order_items_shopify_product_id_idx
    on public.vendor_order_items (shopify_product_id);
create index if not exists vendor_order_items_shopify_variant_id_idx
    on public.vendor_order_items (shopify_variant_id);

create index if not exists vendor_commissions_vendor_id_idx
    on public.vendor_commissions (vendor_id);
create index if not exists vendor_commissions_status_idx
    on public.vendor_commissions (status);
create index if not exists vendor_commissions_vendor_order_item_id_idx
    on public.vendor_commissions (vendor_order_item_id);
create index if not exists vendor_commissions_approved_by_idx
    on public.vendor_commissions (approved_by);
create index if not exists vendor_commissions_vendor_id_status_idx
    on public.vendor_commissions (vendor_id, status);

create index if not exists vendor_live_sessions_vendor_id_idx
    on public.vendor_live_sessions (vendor_id);
create index if not exists vendor_live_sessions_status_idx
    on public.vendor_live_sessions (status);
create index if not exists vendor_live_sessions_starts_at_idx
    on public.vendor_live_sessions (starts_at);

create index if not exists vendor_live_session_products_live_session_id_idx
    on public.vendor_live_session_products (live_session_id);
create index if not exists vendor_live_session_products_vendor_id_idx
    on public.vendor_live_session_products (vendor_id);
create index if not exists vendor_live_session_products_vendor_product_id_idx
    on public.vendor_live_session_products (vendor_product_id);

create index if not exists vendor_audit_logs_vendor_id_idx
    on public.vendor_audit_logs (vendor_id);
create index if not exists vendor_audit_logs_actor_user_id_idx
    on public.vendor_audit_logs (actor_user_id);
create index if not exists vendor_audit_logs_entity_idx
    on public.vendor_audit_logs (entity_type, entity_id);
create index if not exists vendor_audit_logs_created_at_idx
    on public.vendor_audit_logs (created_at);

-- ---------------------------------------------------------------------------
-- Access boundary: RLS enabled with NO broad public policies.
-- Specific admin/vendor policies will be added after this foundation is
-- approved and the first workflows are implemented.
-- ---------------------------------------------------------------------------
alter table public.admin_users                   enable row level security;
alter table public.vendors                       enable row level security;
alter table public.vendor_users                  enable row level security;
alter table public.vendor_product_submissions    enable row level security;
alter table public.vendor_products               enable row level security;
alter table public.vendor_orders                 enable row level security;
alter table public.vendor_order_items            enable row level security;
alter table public.vendor_commissions            enable row level security;
alter table public.vendor_live_sessions          enable row level security;
alter table public.vendor_live_session_products  enable row level security;
alter table public.vendor_audit_logs             enable row level security;
