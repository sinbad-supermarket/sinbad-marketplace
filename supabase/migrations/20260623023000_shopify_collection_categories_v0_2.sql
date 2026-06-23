create table if not exists public.shopify_collection_categories (
    category_id text primary key,
    name text not null,
    parent_name text,
    handle text,
    status text not null default 'active'
        check (status in ('active', 'archived')),
    source text not null default 'shopify_collection'
        check (source in ('shopify_collection')),
    synced_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists shopify_collection_categories_set_updated_at on public.shopify_collection_categories;
create trigger shopify_collection_categories_set_updated_at
    before update on public.shopify_collection_categories
    for each row
    execute function public.set_updated_at();

alter table public.shopify_collection_categories enable row level security;

drop policy if exists shopify_collection_categories_select_authenticated on public.shopify_collection_categories;
create policy shopify_collection_categories_select_authenticated
    on public.shopify_collection_categories
    for select
    to authenticated
    using (status = 'active' or public.is_sinbad_admin());

drop policy if exists shopify_collection_categories_manage_admin on public.shopify_collection_categories;
create policy shopify_collection_categories_manage_admin
    on public.shopify_collection_categories
    for all
    to authenticated
    using (public.is_sinbad_owner_or_admin())
    with check (public.is_sinbad_owner_or_admin());

create index if not exists shopify_collection_categories_name_idx
    on public.shopify_collection_categories (name);

create index if not exists shopify_collection_categories_status_name_idx
    on public.shopify_collection_categories (status, name);

alter table public.vendor_product_submissions
    add column if not exists shopify_category_id text
        references public.shopify_collection_categories(category_id) on delete set null,
    add column if not exists suggested_category text;

alter table public.vendor_products
    add column if not exists shopify_category_id text
        references public.shopify_collection_categories(category_id) on delete set null,
    add column if not exists suggested_category text;

create index if not exists vendor_product_submissions_shopify_category_id_idx
    on public.vendor_product_submissions (shopify_category_id);

create index if not exists vendor_products_shopify_category_id_idx
    on public.vendor_products (shopify_category_id);

drop function if exists public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer, uuid[]);

create or replace function public.create_product_submission(
    p_vendor_id uuid,
    p_title text,
    p_description text default null,
    p_images jsonb default '[]'::jsonb,
    p_price numeric default null,
    p_sku text default null,
    p_inventory_quantity integer default null,
    p_image_ids uuid[] default '{}'::uuid[],
    p_shopify_category_id text default null,
    p_suggested_category text default null
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
    v_shopify_category_id text := nullif(trim(coalesce(p_shopify_category_id, '')), '');
    v_suggested_category text := nullif(trim(coalesce(p_suggested_category, '')), '');
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

    if v_shopify_category_id is null and v_suggested_category is null then
        raise exception 'category or suggested category is required';
    end if;

    if v_shopify_category_id is not null and not exists (
        select 1
        from public.shopify_collection_categories category
        where category.category_id = v_shopify_category_id
          and category.status = 'active'
    ) then
        raise exception 'selected category is not available';
    end if;

    if v_suggested_category is not null and length(v_suggested_category) > 120 then
        raise exception 'suggested category must be 120 characters or fewer';
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
        shopify_category_id,
        suggested_category,
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
        v_shopify_category_id,
        v_suggested_category,
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
            'shopify_category_id', v_submission.shopify_category_id,
            'suggested_category', v_submission.suggested_category
        )
    );

    return to_jsonb(v_submission);
end;
$$;

create or replace function public.submission_has_category(p_submission public.vendor_product_submissions)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        p_submission.shopify_category_id is not null
        or length(trim(coalesce(p_submission.suggested_category, ''))) > 0;
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

    if not public.submission_has_category(v_submission) then
        raise exception 'category or suggested category is required';
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

    if not public.submission_has_category(v_submission) then
        raise exception 'category or suggested category is required';
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
        shopify_category_id,
        suggested_category,
        status
    )
    values (
        v_submission.vendor_id,
        v_submission.id,
        v_submission.title,
        v_submission.shopify_category_id,
        v_submission.suggested_category,
        'approved'
    )
    on conflict (submission_id) do update
    set title = excluded.title,
        shopify_category_id = excluded.shopify_category_id,
        suggested_category = excluded.suggested_category,
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

revoke all on table public.shopify_collection_categories from public, anon, authenticated;
grant select on table public.shopify_collection_categories to authenticated, service_role;
grant insert, update, delete on table public.shopify_collection_categories to service_role;

grant select (shopify_category_id, suggested_category) on table public.vendor_product_submissions to authenticated, service_role;
grant select (shopify_category_id, suggested_category) on table public.vendor_products to authenticated, service_role;

revoke all on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer, uuid[], text, text) from public;
revoke all on function public.submission_has_category(public.vendor_product_submissions) from public;

grant execute on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer, uuid[], text, text) to authenticated, service_role;
grant execute on function public.submission_has_category(public.vendor_product_submissions) to authenticated, service_role;
