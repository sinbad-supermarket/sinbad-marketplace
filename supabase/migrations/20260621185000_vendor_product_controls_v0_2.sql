-- Sinbad Core v0.2 — Vendor Product Controls V1
-- Migration 0012: internal-only vendor product price, inventory, and availability controls.
--
-- Scope guardrails:
--   * No Shopify API calls.
--   * No Shopify sync.
--   * Vendor-safe operational fields only.

alter table public.vendor_products
    add column if not exists base_price numeric(12,3),
    add column if not exists sale_price numeric(12,3),
    add column if not exists inventory_quantity integer,
    add column if not exists operational_status text not null default 'available',
    add column if not exists operational_updated_at timestamptz,
    add column if not exists operational_updated_by uuid references auth.users(id) on delete set null,
    add column if not exists last_shopify_sync_status text,
    add column if not exists last_shopify_sync_error text,
    add column if not exists last_shopify_sync_at timestamptz;

alter table public.vendor_products
    drop constraint if exists vendor_products_base_price_check,
    drop constraint if exists vendor_products_sale_price_check,
    drop constraint if exists vendor_products_inventory_quantity_check,
    drop constraint if exists vendor_products_operational_status_check;

alter table public.vendor_products
    add constraint vendor_products_base_price_check
        check (base_price is null or base_price > 0),
    add constraint vendor_products_sale_price_check
        check (sale_price is null or (sale_price >= 0 and (base_price is null or sale_price <= base_price))),
    add constraint vendor_products_inventory_quantity_check
        check (inventory_quantity is null or inventory_quantity >= 0),
    add constraint vendor_products_operational_status_check
        check (operational_status in ('available', 'out_of_stock', 'paused'));

update public.vendor_products product
set base_price = coalesce(product.base_price, submission.price),
    inventory_quantity = coalesce(product.inventory_quantity, submission.inventory_quantity),
    operational_status = case
        when coalesce(product.inventory_quantity, submission.inventory_quantity) = 0 then 'out_of_stock'
        else coalesce(product.operational_status, 'available')
    end
from public.vendor_product_submissions submission
where submission.id = product.submission_id
  and submission.vendor_id = product.vendor_id;

create index if not exists vendor_products_operational_status_idx
    on public.vendor_products (operational_status);
create index if not exists vendor_products_operational_updated_by_idx
    on public.vendor_products (operational_updated_by);
create index if not exists vendor_products_last_shopify_sync_status_idx
    on public.vendor_products (last_shopify_sync_status);

create or replace function public.can_manage_vendor_product_operations(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.is_sinbad_owner_or_admin() or public.is_vendor_staff_or_owner(p_vendor_id);
$$;

create or replace function public.update_vendor_product_price(
    p_vendor_product_id uuid,
    p_base_price numeric,
    p_sale_price numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_product public.vendor_products;
    v_old_base_price numeric;
    v_old_sale_price numeric;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id
    for update;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if not public.can_manage_vendor_product_operations(v_product.vendor_id) then
        raise exception 'not authorized for vendor product';
    end if;

    if p_base_price is null or p_base_price <= 0 then
        raise exception 'base price must be greater than 0';
    end if;

    if p_sale_price is not null and (p_sale_price < 0 or p_sale_price > p_base_price) then
        raise exception 'sale price must be null, zero, or less than or equal to base price';
    end if;

    v_old_base_price := v_product.base_price;
    v_old_sale_price := v_product.sale_price;

    update public.vendor_products
    set base_price = p_base_price,
        sale_price = p_sale_price,
        operational_updated_at = now(),
        operational_updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_product.vendor_id,
        'vendor_product_price_updated',
        'vendor_product',
        v_product.id,
        jsonb_build_object(
            'old_base_price', v_old_base_price,
            'new_base_price', v_product.base_price,
            'old_sale_price', v_old_sale_price,
            'new_sale_price', v_product.sale_price,
            'shopify_sync_performed', false
        )
    );

    return to_jsonb(v_product);
end;
$$;

create or replace function public.clear_vendor_product_sale_price(p_vendor_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_product public.vendor_products;
    v_old_sale_price numeric;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id
    for update;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if not public.can_manage_vendor_product_operations(v_product.vendor_id) then
        raise exception 'not authorized for vendor product';
    end if;

    v_old_sale_price := v_product.sale_price;

    update public.vendor_products
    set sale_price = null,
        operational_updated_at = now(),
        operational_updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_product.vendor_id,
        'vendor_product_sale_price_cleared',
        'vendor_product',
        v_product.id,
        jsonb_build_object(
            'old_sale_price', v_old_sale_price,
            'new_sale_price', null,
            'shopify_sync_performed', false
        )
    );

    return to_jsonb(v_product);
end;
$$;

create or replace function public.update_vendor_product_inventory(
    p_vendor_product_id uuid,
    p_inventory_quantity integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_product public.vendor_products;
    v_old_inventory integer;
    v_old_status text;
    v_new_status text;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id
    for update;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if not public.can_manage_vendor_product_operations(v_product.vendor_id) then
        raise exception 'not authorized for vendor product';
    end if;

    if p_inventory_quantity is null or p_inventory_quantity < 0 then
        raise exception 'inventory quantity must be greater than or equal to 0';
    end if;

    v_old_inventory := v_product.inventory_quantity;
    v_old_status := v_product.operational_status;
    v_new_status := case
        when p_inventory_quantity = 0 then 'out_of_stock'
        when v_product.operational_status = 'out_of_stock' then 'available'
        else v_product.operational_status
    end;

    update public.vendor_products
    set inventory_quantity = p_inventory_quantity,
        operational_status = v_new_status,
        operational_updated_at = now(),
        operational_updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_product.vendor_id,
        'vendor_product_inventory_updated',
        'vendor_product',
        v_product.id,
        jsonb_build_object(
            'old_inventory_quantity', v_old_inventory,
            'new_inventory_quantity', v_product.inventory_quantity,
            'old_operational_status', v_old_status,
            'new_operational_status', v_product.operational_status,
            'shopify_sync_performed', false
        )
    );

    return to_jsonb(v_product);
end;
$$;

create or replace function public.mark_vendor_product_out_of_stock(p_vendor_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_product public.vendor_products;
    v_old_inventory integer;
    v_old_status text;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id
    for update;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if not public.can_manage_vendor_product_operations(v_product.vendor_id) then
        raise exception 'not authorized for vendor product';
    end if;

    v_old_inventory := v_product.inventory_quantity;
    v_old_status := v_product.operational_status;

    update public.vendor_products
    set inventory_quantity = 0,
        operational_status = 'out_of_stock',
        operational_updated_at = now(),
        operational_updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_product.vendor_id,
        'vendor_product_marked_out_of_stock',
        'vendor_product',
        v_product.id,
        jsonb_build_object(
            'old_inventory_quantity', v_old_inventory,
            'new_inventory_quantity', v_product.inventory_quantity,
            'old_operational_status', v_old_status,
            'new_operational_status', v_product.operational_status,
            'shopify_sync_performed', false
        )
    );

    return to_jsonb(v_product);
end;
$$;

create or replace function public.mark_vendor_product_available(p_vendor_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_product public.vendor_products;
    v_old_status text;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id
    for update;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if not public.can_manage_vendor_product_operations(v_product.vendor_id) then
        raise exception 'not authorized for vendor product';
    end if;

    if coalesce(v_product.inventory_quantity, 0) <= 0 then
        raise exception 'inventory quantity must be greater than 0 before marking available';
    end if;

    v_old_status := v_product.operational_status;

    update public.vendor_products
    set operational_status = 'available',
        operational_updated_at = now(),
        operational_updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_product.vendor_id,
        'vendor_product_marked_available',
        'vendor_product',
        v_product.id,
        jsonb_build_object(
            'old_operational_status', v_old_status,
            'new_operational_status', v_product.operational_status,
            'inventory_quantity', v_product.inventory_quantity,
            'shopify_sync_performed', false
        )
    );

    return to_jsonb(v_product);
end;
$$;

create or replace function public.pause_vendor_product(
    p_vendor_product_id uuid,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_product public.vendor_products;
    v_old_status text;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id
    for update;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if not public.can_manage_vendor_product_operations(v_product.vendor_id) then
        raise exception 'not authorized for vendor product';
    end if;

    v_old_status := v_product.operational_status;

    update public.vendor_products
    set operational_status = 'paused',
        operational_updated_at = now(),
        operational_updated_by = auth.uid()
    where id = v_product.id
    returning * into v_product;

    perform public.write_vendor_audit_log(
        v_product.vendor_id,
        'vendor_product_paused',
        'vendor_product',
        v_product.id,
        jsonb_build_object(
            'old_operational_status', v_old_status,
            'new_operational_status', v_product.operational_status,
            'reason', nullif(trim(coalesce(p_reason, '')), ''),
            'shopify_sync_performed', false
        )
    );

    return to_jsonb(v_product);
end;
$$;

revoke all on function public.update_vendor_product_price(uuid, numeric, numeric) from public;
revoke all on function public.clear_vendor_product_sale_price(uuid) from public;
revoke all on function public.update_vendor_product_inventory(uuid, integer) from public;
revoke all on function public.mark_vendor_product_out_of_stock(uuid) from public;
revoke all on function public.mark_vendor_product_available(uuid) from public;
revoke all on function public.pause_vendor_product(uuid, text) from public;

grant execute on function public.update_vendor_product_price(uuid, numeric, numeric) to authenticated, service_role;
grant execute on function public.clear_vendor_product_sale_price(uuid) to authenticated, service_role;
grant execute on function public.update_vendor_product_inventory(uuid, integer) to authenticated, service_role;
grant execute on function public.mark_vendor_product_out_of_stock(uuid) to authenticated, service_role;
grant execute on function public.mark_vendor_product_available(uuid) to authenticated, service_role;
grant execute on function public.pause_vendor_product(uuid, text) to authenticated, service_role;
