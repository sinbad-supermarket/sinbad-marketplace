-- Sinbad Core v0.2 — Shopify Product Publishing Dry Run V1
-- Migration 0007: publish tracking + dry-run payload generation
--
-- Scope guardrails:
--   * Dry run only. No Shopify API calls. No product creation. No catalog writes.
--   * Admin-triggered only.
--   * Approval remains separate from publishing.

-- ---------------------------------------------------------------------------
-- vendor_products publish tracking
-- ---------------------------------------------------------------------------
alter table public.vendor_products
    add column if not exists publish_status text not null default 'not_published'
        check (publish_status in ('not_published', 'dry_run_ready', 'publishing', 'published', 'failed')),
    add column if not exists shopify_publish_error text,
    add column if not exists shopify_published_at timestamptz,
    add column if not exists publish_attempt_count integer not null default 0
        check (publish_attempt_count >= 0),
    add column if not exists publish_idempotency_key text unique,
    add column if not exists last_publish_payload jsonb,
    add column if not exists last_publish_attempt_at timestamptz,
    add column if not exists published_by uuid references auth.users(id) on delete set null;

create index if not exists vendor_products_publish_status_idx
    on public.vendor_products (publish_status);
create index if not exists vendor_products_last_publish_attempt_at_idx
    on public.vendor_products (last_publish_attempt_at);
create index if not exists vendor_products_published_by_idx
    on public.vendor_products (published_by);

-- ---------------------------------------------------------------------------
-- vendor_product_publish_attempts: dry-run/live attempt history
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_product_publish_attempts (
    id                  uuid        primary key default gen_random_uuid(),
    vendor_product_id   uuid        not null references public.vendor_products(id) on delete cascade,
    vendor_id           uuid        not null references public.vendors(id) on delete restrict,
    mode                text        not null check (mode in ('dry_run', 'live')),
    status              text        not null check (status in ('started', 'succeeded', 'failed')),
    idempotency_key     text        not null,
    request_payload     jsonb       not null default '{}'::jsonb,
    response_payload    jsonb       not null default '{}'::jsonb,
    error               text,
    created_by          uuid        references auth.users(id) on delete set null,
    created_at          timestamptz not null default now()
);

create index if not exists vendor_product_publish_attempts_vendor_product_id_idx
    on public.vendor_product_publish_attempts (vendor_product_id);
create index if not exists vendor_product_publish_attempts_vendor_id_idx
    on public.vendor_product_publish_attempts (vendor_id);
create index if not exists vendor_product_publish_attempts_mode_status_idx
    on public.vendor_product_publish_attempts (mode, status);
create index if not exists vendor_product_publish_attempts_idempotency_key_idx
    on public.vendor_product_publish_attempts (idempotency_key);
create index if not exists vendor_product_publish_attempts_created_at_idx
    on public.vendor_product_publish_attempts (created_at);

alter table public.vendor_product_publish_attempts enable row level security;

drop policy if exists vendor_product_publish_attempts_select_admin_or_vendor on public.vendor_product_publish_attempts;
create policy vendor_product_publish_attempts_select_admin_or_vendor
    on public.vendor_product_publish_attempts
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

-- ---------------------------------------------------------------------------
-- dry_run_publish_vendor_product: build and store Shopify payload preview only
-- ---------------------------------------------------------------------------
create or replace function public.dry_run_publish_vendor_product(
    p_vendor_product_id uuid,
    p_publish_environment text default 'local'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_product public.vendor_products;
    v_submission public.vendor_product_submissions;
    v_vendor public.vendors;
    v_idempotency_key text;
    v_images jsonb;
    v_payload jsonb;
    v_attempt public.vendor_product_publish_attempts;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.is_sinbad_owner_or_admin() then
        raise exception 'owner or admin role required';
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id
    for update;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if v_product.status <> 'approved' then
        raise exception 'vendor product must be approved before dry-run publish';
    end if;

    if v_product.publish_status = 'published' or v_product.shopify_product_id is not null then
        raise exception 'vendor product is already published';
    end if;

    select * into v_submission
    from public.vendor_product_submissions
    where id = v_product.submission_id;

    if v_submission.id is null then
        raise exception 'product submission not found';
    end if;

    if v_submission.price is null then
        raise exception 'price is required before dry-run publish';
    end if;

    select * into v_vendor
    from public.vendors
    where id = v_product.vendor_id;

    if v_vendor.id is null then
        raise exception 'vendor not found';
    end if;

    select coalesce(
        jsonb_agg(jsonb_build_object('src', image_url)),
        '[]'::jsonb
    )
    into v_images
    from jsonb_array_elements_text(coalesce(v_submission.images, '[]'::jsonb)) as image_url;

    v_idempotency_key := coalesce(
        v_product.publish_idempotency_key,
        'shopify-dry-run:' || v_product.id::text
    );

    v_payload := jsonb_build_object(
        'dry_run', true,
        'shopify_write_performed', false,
        'product', jsonb_build_object(
            'title', v_submission.title,
            'body_html', coalesce(v_submission.description, ''),
            'status', 'draft',
            'vendor', v_vendor.name,
            'tags', jsonb_build_array(
                'sinbad-vendor',
                'vendor:' || v_vendor.slug,
                'source:sinbad-core'
            ),
            'variants', jsonb_build_array(
                jsonb_build_object(
                    'price', v_submission.price,
                    'sku', v_submission.sku,
                    'inventory_quantity', v_submission.inventory_quantity
                )
            ),
            'images', v_images,
            'metafields', jsonb_build_array(
                jsonb_build_object(
                    'namespace', 'sinbad',
                    'key', 'vendor_id',
                    'type', 'single_line_text_field',
                    'value', v_vendor.id::text
                ),
                jsonb_build_object(
                    'namespace', 'sinbad',
                    'key', 'vendor_product_id',
                    'type', 'single_line_text_field',
                    'value', v_product.id::text
                ),
                jsonb_build_object(
                    'namespace', 'sinbad',
                    'key', 'submission_id',
                    'type', 'single_line_text_field',
                    'value', v_submission.id::text
                ),
                jsonb_build_object(
                    'namespace', 'sinbad',
                    'key', 'publish_environment',
                    'type', 'single_line_text_field',
                    'value', coalesce(nullif(trim(p_publish_environment), ''), 'local')
                ),
                jsonb_build_object(
                    'namespace', 'sinbad',
                    'key', 'source',
                    'type', 'single_line_text_field',
                    'value', 'sinbad-core'
                )
            )
        )
    );

    insert into public.vendor_product_publish_attempts (
        vendor_product_id,
        vendor_id,
        mode,
        status,
        idempotency_key,
        request_payload,
        response_payload,
        created_by
    )
    values (
        v_product.id,
        v_product.vendor_id,
        'dry_run',
        'succeeded',
        v_idempotency_key,
        jsonb_build_object(
            'vendor_product_id', v_product.id,
            'publish_environment', coalesce(nullif(trim(p_publish_environment), ''), 'local')
        ),
        v_payload,
        auth.uid()
    )
    returning * into v_attempt;

    update public.vendor_products
    set publish_status = 'dry_run_ready',
        shopify_publish_error = null,
        publish_attempt_count = publish_attempt_count + 1,
        publish_idempotency_key = v_idempotency_key,
        last_publish_payload = v_payload,
        last_publish_attempt_at = now(),
        published_by = auth.uid()
    where id = v_product.id
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_product.vendor_id,
        'shopify_product_publish_dry_run',
        'vendor_product',
        v_product.id,
        jsonb_build_object(
            'attempt_id', v_attempt.id,
            'idempotency_key', v_idempotency_key,
            'shopify_write_performed', false
        )
    );

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'vendor_product_id', v_product.id,
        'publish_status', v_product.publish_status,
        'idempotency_key', v_idempotency_key,
        'payload', v_payload,
        'message', 'Dry run only — no Shopify product was created.'
    );
end;
$$;

revoke all on function public.dry_run_publish_vendor_product(uuid, text) from public;
grant execute on function public.dry_run_publish_vendor_product(uuid, text) to authenticated, service_role;
