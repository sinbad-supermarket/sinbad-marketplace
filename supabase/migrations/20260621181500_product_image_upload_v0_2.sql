-- Sinbad Core v0.2 — Product Image Upload V1
-- Migration 0011: private product image storage, metadata table, RPC validation,
-- and dry-run payload integration.
--
-- Scope guardrails:
--   * No Shopify API calls.
--   * Keep vendor_product_submissions.images jsonb for compatibility.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'vendor-product-images',
    'vendor-product-images',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.vendor_product_submission_images (
    id                 uuid primary key default gen_random_uuid(),
    vendor_id          uuid not null references public.vendors(id) on delete cascade,
    submission_id      uuid references public.vendor_product_submissions(id) on delete cascade,
    uploaded_by        uuid references auth.users(id) on delete set null,
    storage_bucket     text not null default 'vendor-product-images',
    storage_path       text not null,
    original_filename  text,
    content_type       text not null,
    file_size_bytes    integer not null check (file_size_bytes > 0 and file_size_bytes <= 5242880),
    width              integer check (width is null or width > 0),
    height             integer check (height is null or height > 0),
    alt_text           text,
    sort_order         integer not null default 0 check (sort_order >= 0),
    status             text not null default 'active' check (status in ('active', 'removed')),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (storage_bucket, storage_path),
    constraint vendor_product_submission_images_bucket_check
        check (storage_bucket = 'vendor-product-images'),
    constraint vendor_product_submission_images_content_type_check
        check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
    constraint vendor_product_submission_images_path_check
        check (
            storage_path like ('vendors/' || vendor_id::text || '/%')
        )
);

drop trigger if exists vendor_product_submission_images_set_updated_at
    on public.vendor_product_submission_images;
create trigger vendor_product_submission_images_set_updated_at
    before update on public.vendor_product_submission_images
    for each row execute function public.set_updated_at();

create index if not exists vendor_product_submission_images_vendor_id_idx
    on public.vendor_product_submission_images (vendor_id);
create index if not exists vendor_product_submission_images_submission_id_idx
    on public.vendor_product_submission_images (submission_id);
create index if not exists vendor_product_submission_images_vendor_submission_idx
    on public.vendor_product_submission_images (vendor_id, submission_id);
create index if not exists vendor_product_submission_images_submission_sort_idx
    on public.vendor_product_submission_images (submission_id, sort_order);
create index if not exists vendor_product_submission_images_uploaded_by_idx
    on public.vendor_product_submission_images (uploaded_by);
create index if not exists vendor_product_submission_images_status_idx
    on public.vendor_product_submission_images (status);

alter table public.vendor_product_submission_images enable row level security;

drop policy if exists vendor_product_submission_images_select_admin_or_vendor
    on public.vendor_product_submission_images;
create policy vendor_product_submission_images_select_admin_or_vendor
    on public.vendor_product_submission_images
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_product_submission_images_insert_admin_or_vendor
    on public.vendor_product_submission_images;
create policy vendor_product_submission_images_insert_admin_or_vendor
    on public.vendor_product_submission_images
    for insert
    to authenticated
    with check (
        (public.is_sinbad_owner_or_admin() or public.is_vendor_staff_or_owner(vendor_id))
        and uploaded_by = auth.uid()
    );

drop policy if exists vendor_product_submission_images_update_admin_or_vendor
    on public.vendor_product_submission_images;
create policy vendor_product_submission_images_update_admin_or_vendor
    on public.vendor_product_submission_images
    for update
    to authenticated
    using (
        public.is_sinbad_owner_or_admin()
        or (
            public.is_vendor_staff_or_owner(vendor_id)
            and (
                submission_id is null
                or exists (
                    select 1
                    from public.vendor_product_submissions s
                    where s.id = submission_id
                      and s.vendor_id = vendor_id
                      and s.status in ('draft', 'rejected')
                )
            )
        )
    )
    with check (
        public.is_sinbad_owner_or_admin()
        or (
            public.is_vendor_staff_or_owner(vendor_id)
            and (
                submission_id is null
                or exists (
                    select 1
                    from public.vendor_product_submissions s
                    where s.id = submission_id
                      and s.vendor_id = vendor_id
                      and s.status in ('draft', 'rejected')
                )
            )
        )
    );

drop policy if exists vendor_product_submission_images_delete_admin_or_vendor
    on public.vendor_product_submission_images;
create policy vendor_product_submission_images_delete_admin_or_vendor
    on public.vendor_product_submission_images
    for delete
    to authenticated
    using (
        public.is_sinbad_owner_or_admin()
        or (
            public.is_vendor_staff_or_owner(vendor_id)
            and (
                submission_id is null
                or exists (
                    select 1
                    from public.vendor_product_submissions s
                    where s.id = submission_id
                      and s.vendor_id = vendor_id
                      and s.status in ('draft', 'rejected')
                )
            )
        )
    );

create or replace function public.storage_vendor_id_from_product_image_path(p_name text)
returns uuid
language plpgsql
stable
set search_path = public
as $$
begin
    if split_part(p_name, '/', 1) <> 'vendors' then
        return null;
    end if;

    return split_part(p_name, '/', 2)::uuid;
exception when others then
    return null;
end;
$$;

drop policy if exists vendor_product_images_storage_select_admin_or_vendor
    on storage.objects;
create policy vendor_product_images_storage_select_admin_or_vendor
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'vendor-product-images'
        and (
            public.is_sinbad_admin()
            or public.is_vendor_member(public.storage_vendor_id_from_product_image_path(name))
        )
    );

drop policy if exists vendor_product_images_storage_insert_admin_or_vendor
    on storage.objects;
create policy vendor_product_images_storage_insert_admin_or_vendor
    on storage.objects
    for insert
    to authenticated
    with check (
        bucket_id = 'vendor-product-images'
        and split_part(name, '/', 1) = 'vendors'
        and (
            public.is_sinbad_owner_or_admin()
            or public.is_vendor_staff_or_owner(public.storage_vendor_id_from_product_image_path(name))
        )
    );

drop policy if exists vendor_product_images_storage_update_admin_or_vendor
    on storage.objects;
create policy vendor_product_images_storage_update_admin_or_vendor
    on storage.objects
    for update
    to authenticated
    using (
        bucket_id = 'vendor-product-images'
        and (
            public.is_sinbad_owner_or_admin()
            or public.is_vendor_staff_or_owner(public.storage_vendor_id_from_product_image_path(name))
        )
    )
    with check (
        bucket_id = 'vendor-product-images'
        and (
            public.is_sinbad_owner_or_admin()
            or public.is_vendor_staff_or_owner(public.storage_vendor_id_from_product_image_path(name))
        )
    );

drop policy if exists vendor_product_images_storage_delete_admin_or_vendor
    on storage.objects;
create policy vendor_product_images_storage_delete_admin_or_vendor
    on storage.objects
    for delete
    to authenticated
    using (
        bucket_id = 'vendor-product-images'
        and (
            public.is_sinbad_owner_or_admin()
            or public.is_vendor_staff_or_owner(public.storage_vendor_id_from_product_image_path(name))
        )
    );

drop function if exists public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer);

create or replace function public.create_product_submission(
    p_vendor_id uuid,
    p_title text,
    p_description text default null,
    p_images jsonb default '[]'::jsonb,
    p_price numeric default null,
    p_sku text default null,
    p_inventory_quantity integer default null,
    p_image_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_submission public.vendor_product_submissions;
    v_created_on_behalf_by_admin boolean;
    v_image_ids uuid[] := coalesce(p_image_ids, '{}'::uuid[]);
    v_image_count integer;
    v_distinct_image_count integer;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    v_created_on_behalf_by_admin := public.is_sinbad_owner_or_admin();

    if not (
        v_created_on_behalf_by_admin
        or public.is_vendor_staff_or_owner(p_vendor_id)
    ) then
        raise exception 'not authorized for vendor';
    end if;

    if p_title is null or length(trim(p_title)) = 0 then
        raise exception 'title is required';
    end if;

    select count(*), count(distinct image_id)
    into v_image_count, v_distinct_image_count
    from unnest(v_image_ids) as image_id;

    if v_image_count > 6 then
        raise exception 'a maximum of 6 images is allowed';
    end if;

    if v_image_count <> v_distinct_image_count then
        raise exception 'duplicate image IDs are not allowed';
    end if;

    if v_image_count > 0 and (
        select count(*)
        from public.vendor_product_submission_images image
        where image.id = any(v_image_ids)
          and image.vendor_id = p_vendor_id
          and image.status = 'active'
          and image.submission_id is null
    ) <> v_image_count then
        raise exception 'all images must be active, unattached, and belong to the vendor';
    end if;

    insert into public.vendor_product_submissions (
        vendor_id,
        submitted_by,
        title,
        description,
        images,
        price,
        sku,
        inventory_quantity,
        status
    )
    values (
        p_vendor_id,
        auth.uid(),
        trim(p_title),
        p_description,
        coalesce(p_images, '[]'::jsonb),
        p_price,
        p_sku,
        p_inventory_quantity,
        'draft'
    )
    returning * into v_submission;

    if v_image_count > 0 then
        update public.vendor_product_submission_images image
        set submission_id = v_submission.id,
            sort_order = ordered_image.sort_order
        from (
            select image_id, ordinality::integer - 1 as sort_order
            from unnest(v_image_ids) with ordinality as selected(image_id, ordinality)
        ) as ordered_image
        where image.id = ordered_image.image_id
          and image.vendor_id = v_submission.vendor_id
          and image.submission_id is null;
    end if;

    perform public.write_vendor_audit_log(
        v_submission.vendor_id,
        'product_submission_created',
        'vendor_product_submission',
        v_submission.id,
        jsonb_build_object(
            'status', v_submission.status,
            'created_on_behalf_by_admin', v_created_on_behalf_by_admin,
            'image_count', v_image_count
        )
    );

    return to_jsonb(v_submission);
end;
$$;

create or replace function public.submission_has_active_images(p_submission public.vendor_product_submissions)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        exists (
            select 1
            from public.vendor_product_submission_images image
            where image.submission_id = p_submission.id
              and image.vendor_id = p_submission.vendor_id
              and image.status = 'active'
        )
        or jsonb_array_length(coalesce(p_submission.images, '[]'::jsonb)) > 0;
$$;

create or replace function public.submit_product_submission(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_submission public.vendor_product_submissions;
    v_submitted_on_behalf_by_admin boolean;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_submission
    from public.vendor_product_submissions
    where id = p_submission_id
    for update;

    if v_submission.id is null then
        raise exception 'submission not found';
    end if;

    v_submitted_on_behalf_by_admin := public.is_sinbad_owner_or_admin();

    if not (
        v_submitted_on_behalf_by_admin
        or public.is_vendor_staff_or_owner(v_submission.vendor_id)
    ) then
        raise exception 'not authorized for vendor';
    end if;

    if v_submission.status not in ('draft', 'rejected') then
        raise exception 'submission cannot be submitted from status %', v_submission.status;
    end if;

    if not public.submission_has_active_images(v_submission) then
        raise exception 'at least one active product image is required';
    end if;

    update public.vendor_product_submissions
    set status = 'submitted',
        reviewed_by = null,
        reviewed_at = null
    where id = p_submission_id
    returning * into v_submission;

    perform public.write_vendor_audit_log(
        v_submission.vendor_id,
        'product_submission_submitted',
        'vendor_product_submission',
        v_submission.id,
        jsonb_build_object(
            'status', v_submission.status,
            'submitted_on_behalf_by_admin', v_submitted_on_behalf_by_admin
        )
    );

    return to_jsonb(v_submission);
end;
$$;

create or replace function public.approve_product_submission(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_submission public.vendor_product_submissions;
    v_product public.vendor_products;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.is_sinbad_reviewer() then
        raise exception 'reviewer role required';
    end if;

    select * into v_submission
    from public.vendor_product_submissions
    where id = p_submission_id
    for update;

    if v_submission.id is null then
        raise exception 'submission not found';
    end if;

    if v_submission.status not in ('submitted', 'under_review') then
        raise exception 'submission cannot be approved from status %', v_submission.status;
    end if;

    if not public.submission_has_active_images(v_submission) then
        raise exception 'at least one active product image is required';
    end if;

    update public.vendor_product_submissions
    set status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_submission_id
    returning * into v_submission;

    insert into public.vendor_products (
        vendor_id,
        submission_id,
        title,
        status
    )
    values (
        v_submission.vendor_id,
        v_submission.id,
        v_submission.title,
        'approved'
    )
    on conflict (submission_id) do update
    set title = excluded.title,
        status = 'approved'
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_submission.vendor_id,
        'product_submission_approved',
        'vendor_product_submission',
        v_submission.id,
        jsonb_build_object('vendor_product_id', v_product.id, 'status', v_submission.status)
    );

    return jsonb_build_object(
        'submission', to_jsonb(v_submission),
        'product', to_jsonb(v_product)
    );
end;
$$;

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
    v_uploaded_image_count integer;
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

    select count(*),
           coalesce(
               jsonb_agg(
                   jsonb_build_object(
                       'storage_bucket', image.storage_bucket,
                       'storage_path', image.storage_path,
                       'alt', coalesce(image.alt_text, v_submission.title),
                       'source', 'supabase_storage',
                       'signed_url_required', true
                   )
                   order by image.sort_order, image.created_at
               ),
               '[]'::jsonb
           )
    into v_uploaded_image_count, v_images
    from public.vendor_product_submission_images image
    where image.submission_id = v_submission.id
      and image.vendor_id = v_submission.vendor_id
      and image.status = 'active';

    if v_uploaded_image_count = 0 then
        select coalesce(
            jsonb_agg(jsonb_build_object('src', image_url, 'source', 'legacy_jsonb_url')),
            '[]'::jsonb
        )
        into v_images
        from jsonb_array_elements_text(coalesce(v_submission.images, '[]'::jsonb)) as image_url;
    end if;

    if jsonb_array_length(coalesce(v_images, '[]'::jsonb)) = 0 then
        raise exception 'at least one active product image is required';
    end if;

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
            'shopify_write_performed', false,
            'image_source', case when v_uploaded_image_count > 0 then 'supabase_storage' else 'legacy_jsonb_url' end
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

revoke all on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer, uuid[]) from public;
revoke all on function public.submit_product_submission(uuid) from public;
revoke all on function public.approve_product_submission(uuid) from public;
revoke all on function public.dry_run_publish_vendor_product(uuid, text) from public;

grant execute on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer, uuid[]) to authenticated, service_role;
grant execute on function public.submit_product_submission(uuid) to authenticated, service_role;
grant execute on function public.approve_product_submission(uuid) to authenticated, service_role;
grant execute on function public.dry_run_publish_vendor_product(uuid, text) to authenticated, service_role;
