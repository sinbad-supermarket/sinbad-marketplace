-- Sinbad Marketplace v0.2 — Vendor Product Submission Editing
-- Allows vendors/admins to edit vendor-owned submissions only while they are
-- still editable: draft, rejected, or changes_requested.

create or replace function public.update_product_submission(
    p_submission_id uuid,
    p_title text,
    p_description text default null,
    p_price numeric default null,
    p_sku text default null,
    p_inventory_quantity integer default null,
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
    v_updated_on_behalf_by_admin boolean;
    v_shopify_category_id text := nullif(trim(coalesce(p_shopify_category_id, '')), '');
    v_suggested_category text := nullif(trim(coalesce(p_suggested_category, '')), '');
    v_barcode text := nullif(trim(coalesce(p_barcode, '')), '');
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

    v_updated_on_behalf_by_admin := public.is_sinbad_owner_or_admin();

    if not (
        v_updated_on_behalf_by_admin
        or public.is_vendor_staff_or_owner(v_submission.vendor_id)
    ) then
        raise exception 'not authorized for vendor';
    end if;

    if v_submission.status not in ('draft', 'rejected', 'changes_requested') then
        raise exception 'submission cannot be edited from status %', v_submission.status;
    end if;

    if exists (
        select 1
        from public.vendor_products product
        where product.submission_id = v_submission.id
          and (
              product.shopify_product_id is not null
              or product.publish_status in ('shopify_draft_created', 'published')
          )
    ) then
        raise exception 'submission is already linked to Shopify and cannot be edited';
    end if;

    if p_title is null or length(trim(p_title)) = 0 then
        raise exception 'title is required';
    end if;

    if p_price is null or p_price <= 0 then
        raise exception 'price must be greater than 0';
    end if;

    if p_sku is null or length(trim(p_sku)) = 0 then
        raise exception 'sku is required';
    end if;

    if p_inventory_quantity is null or p_inventory_quantity < 0 then
        raise exception 'inventory quantity must be greater than or equal to 0';
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

    update public.vendor_product_submissions
    set title = trim(p_title),
        description = p_description,
        price = p_price,
        sku = trim(p_sku),
        barcode = v_barcode,
        inventory_quantity = p_inventory_quantity,
        shopify_category_id = v_shopify_category_id,
        suggested_category = v_suggested_category
    where id = p_submission_id
    returning * into v_submission;

    perform public.write_vendor_audit_log(
        v_submission.vendor_id,
        'product_submission_updated',
        'vendor_product_submission',
        v_submission.id,
        jsonb_build_object(
            'status', v_submission.status,
            'updated_on_behalf_by_admin', v_updated_on_behalf_by_admin,
            'shopify_category_id', v_submission.shopify_category_id,
            'suggested_category', v_submission.suggested_category,
            'barcode_provided', v_submission.barcode is not null
        )
    );

    return to_jsonb(v_submission);
end;
$$;

revoke all on function public.update_product_submission(
    uuid, text, text, numeric, text, integer, text, text, text
) from public;

grant execute on function public.update_product_submission(
    uuid, text, text, numeric, text, integer, text, text, text
) to authenticated, service_role;
