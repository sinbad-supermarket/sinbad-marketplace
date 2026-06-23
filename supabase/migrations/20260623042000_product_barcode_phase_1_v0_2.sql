-- Sinbad Marketplace v0.2 — Product Barcode Phase 1
-- Adds optional EAN/UPC barcode capture for vendor submissions and carries it
-- into approved vendor products. Shopify publishing is intentionally unchanged.

alter table public.vendor_product_submissions
    add column if not exists barcode text;

alter table public.vendor_products
    add column if not exists barcode text;

alter table public.vendor_product_submissions
    drop constraint if exists vendor_product_submissions_barcode_format_check,
    add constraint vendor_product_submissions_barcode_format_check
        check (
            barcode is null
            or barcode ~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$'
        );

alter table public.vendor_products
    drop constraint if exists vendor_products_barcode_format_check,
    add constraint vendor_products_barcode_format_check
        check (
            barcode is null
            or barcode ~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$'
        );

drop function if exists public.create_product_submission(
    uuid, text, text, jsonb, numeric, text, integer, uuid[], text, text
);

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
    p_suggested_category text default null,
    p_barcode text default null
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
    v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
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

    if v_barcode is not null and v_barcode !~ '^[0-9]{8}$|^[0-9]{12}$|^[0-9]{13}$|^[0-9]{14}$' then
        raise exception 'barcode must be 8, 12, 13, or 14 digits';
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
        barcode,
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
        v_barcode,
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
            'suggested_category', v_submission.suggested_category,
            'barcode_provided', v_submission.barcode is not null
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
        barcode,
        shopify_category_id,
        suggested_category,
        status
    )
    values (
        v_submission.vendor_id,
        v_submission.id,
        v_submission.title,
        v_submission.barcode,
        v_submission.shopify_category_id,
        v_submission.suggested_category,
        'approved'
    )
    on conflict (submission_id) do update
    set title = excluded.title,
        barcode = excluded.barcode,
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

revoke all on function public.create_product_submission(
    uuid, text, text, jsonb, numeric, text, integer, uuid[], text, text, text
) from public;

grant execute on function public.create_product_submission(
    uuid, text, text, jsonb, numeric, text, integer, uuid[], text, text, text
) to authenticated, service_role;
