-- Sinbad Core v0.2 — Shopify Draft Product Publishing V1
-- Migration 0008: draft-only Shopify creation tracking
--
-- Scope guardrails:
--   * Draft product creation only.
--   * No publishablePublish support.
--   * No sales channel publication.
--   * No customer-visible publishing.

-- ---------------------------------------------------------------------------
-- vendor_products publish tracking extensions
-- ---------------------------------------------------------------------------
alter table public.vendor_products
    add column if not exists shopify_inventory_item_id text,
    add column if not exists shopify_created_status text,
    add column if not exists shopify_created_at timestamptz,
    add column if not exists shopify_last_verified_at timestamptz,
    add column if not exists rollback_reason text,
    add column if not exists rollback_at timestamptz,
    add column if not exists rollback_by uuid references auth.users(id) on delete set null;

do $$
declare
    v_constraint record;
begin
    for v_constraint in
        select conname
        from pg_constraint
        where conrelid = 'public.vendor_products'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) like '%publish_status%'
    loop
        execute format('alter table public.vendor_products drop constraint %I', v_constraint.conname);
    end loop;
end;
$$;

alter table public.vendor_products
    add constraint vendor_products_publish_status_check
    check (publish_status in (
        'not_published',
        'dry_run_ready',
        'publishing',
        'shopify_draft_created',
        'published',
        'failed',
        'failed_needs_review',
        'rolled_back'
    ));

create index if not exists vendor_products_shopify_inventory_item_id_idx
    on public.vendor_products (shopify_inventory_item_id);
create index if not exists vendor_products_shopify_created_status_idx
    on public.vendor_products (shopify_created_status);
create index if not exists vendor_products_rollback_by_idx
    on public.vendor_products (rollback_by);

-- ---------------------------------------------------------------------------
-- vendor_product_publish_attempts constraint extensions
-- ---------------------------------------------------------------------------
do $$
declare
    v_constraint record;
begin
    for v_constraint in
        select conname
        from pg_constraint
        where conrelid = 'public.vendor_product_publish_attempts'::regclass
          and contype = 'c'
          and (
              pg_get_constraintdef(oid) like '%mode%'
              or pg_get_constraintdef(oid) like '%status%'
          )
    loop
        execute format('alter table public.vendor_product_publish_attempts drop constraint %I', v_constraint.conname);
    end loop;
end;
$$;

alter table public.vendor_product_publish_attempts
    add constraint vendor_product_publish_attempts_mode_check
    check (mode in ('dry_run', 'draft_create', 'live')),
    add constraint vendor_product_publish_attempts_status_check
    check (status in ('started', 'succeeded', 'failed', 'needs_review'));

drop index if exists public.vendor_product_publish_attempts_idempotency_key_idx;
create unique index if not exists vendor_product_publish_attempts_idempotency_key_key
    on public.vendor_product_publish_attempts (idempotency_key);

-- ---------------------------------------------------------------------------
-- dry_run_publish_vendor_product: keep dry-run safe with unique attempt keys
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
    v_attempt_idempotency_key text;
    v_product_idempotency_key text;
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

    if v_product.publish_status in ('published', 'shopify_draft_created')
       or v_product.shopify_product_id is not null then
        raise exception 'vendor product is already linked to Shopify';
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

    v_attempt_idempotency_key := 'shopify-dry-run:' || v_product.id::text || ':' || gen_random_uuid()::text;
    v_product_idempotency_key := coalesce(
        v_product.publish_idempotency_key,
        'shopify-draft-create:' || v_product.id::text || ':v1'
    );

    v_payload := jsonb_build_object(
        'dry_run', true,
        'shopify_write_performed', false,
        'product', jsonb_build_object(
            'title', v_submission.title,
            'descriptionHtml', coalesce(v_submission.description, ''),
            'status', 'DRAFT',
            'vendor', v_vendor.name,
            'tags', jsonb_build_array(
                'sinbad-core',
                'vendor-product',
                'vendor:' || v_vendor.slug,
                'draft-only'
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
        v_attempt_idempotency_key,
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
        publish_idempotency_key = v_product_idempotency_key,
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
            'attempt_idempotency_key', v_attempt_idempotency_key,
            'publish_idempotency_key', v_product_idempotency_key,
            'shopify_write_performed', false
        )
    );

    return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'vendor_product_id', v_product.id,
        'publish_status', v_product.publish_status,
        'idempotency_key', v_product_idempotency_key,
        'payload', v_payload,
        'message', 'Dry run only — no Shopify product was created.'
    );
end;
$$;
