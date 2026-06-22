-- Sinbad Core v0.2 — Vendor Live Pinning Hardening
-- Migration 0010: require RPC-only pin/unpin with session, ownership, and publish checks
--
-- Scope guardrails:
--   * Vendor Live pin/unpin hardening only.
--   * No Shopify API changes.
--   * No app/frontend changes.

drop policy if exists vendor_live_session_products_insert_admin_or_vendor
    on public.vendor_live_session_products;

drop policy if exists vendor_live_session_products_delete_admin_or_vendor
    on public.vendor_live_session_products;

create or replace function public.pin_vendor_live_product(
    p_live_session_id uuid,
    p_vendor_product_id uuid,
    p_position integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.vendor_live_sessions;
    v_product public.vendor_products;
    v_pin public.vendor_live_session_products;
    v_position integer;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_session
    from public.vendor_live_sessions
    where id = p_live_session_id
    for update;

    if v_session.id is null then
        raise exception 'live session not found';
    end if;

    if not (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(v_session.vendor_id)) then
        raise exception 'not authorized for vendor';
    end if;

    if v_session.status not in ('draft', 'scheduled', 'live') then
        raise exception 'live session cannot be pinned from status %', v_session.status;
    end if;

    select * into v_product
    from public.vendor_products
    where id = p_vendor_product_id;

    if v_product.id is null then
        raise exception 'vendor product not found';
    end if;

    if v_product.vendor_id <> v_session.vendor_id then
        raise exception 'product does not belong to live session vendor';
    end if;

    if v_product.status not in ('approved', 'published') then
        raise exception 'product cannot be pinned from status %', v_product.status;
    end if;

    if v_product.publish_status not in ('shopify_draft_created', 'published') then
        raise exception 'product cannot be pinned from publish status %',
            coalesce(v_product.publish_status, 'null');
    end if;

    if p_position is not null and p_position < 0 then
        raise exception 'position must be zero or greater';
    end if;

    if p_position is null then
        select coalesce(max(position) + 1, 0) into v_position
        from public.vendor_live_session_products
        where live_session_id = p_live_session_id;
    else
        v_position := p_position;
    end if;

    insert into public.vendor_live_session_products (
        live_session_id,
        vendor_id,
        vendor_product_id,
        position
    )
    values (
        v_session.id,
        v_session.vendor_id,
        v_product.id,
        v_position
    )
    on conflict (live_session_id, vendor_product_id) do update
    set position = excluded.position
    returning * into v_pin;

    perform public.write_vendor_audit_log(
        v_session.vendor_id,
        'vendor_live_product_pinned',
        'vendor_live_session_product',
        v_pin.id,
        jsonb_build_object(
            'live_session_id', v_session.id,
            'vendor_product_id', v_product.id,
            'position', v_pin.position,
            'session_status', v_session.status,
            'product_status', v_product.status,
            'publish_status', v_product.publish_status
        )
    );

    return to_jsonb(v_pin);
end;
$$;

create or replace function public.unpin_vendor_live_product(
    p_live_session_id uuid,
    p_vendor_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pin public.vendor_live_session_products;
    v_session public.vendor_live_sessions;
    v_is_admin boolean;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    select * into v_pin
    from public.vendor_live_session_products
    where live_session_id = p_live_session_id
      and vendor_product_id = p_vendor_product_id
    for update;

    if v_pin.id is null then
        raise exception 'pinned product not found';
    end if;

    select * into v_session
    from public.vendor_live_sessions
    where id = v_pin.live_session_id
    for update;

    if v_session.id is null then
        raise exception 'live session not found';
    end if;

    v_is_admin := public.is_sinbad_admin();

    if not (v_is_admin or public.is_vendor_staff_or_owner(v_pin.vendor_id)) then
        raise exception 'not authorized for vendor';
    end if;

    if not v_is_admin and v_session.status not in ('draft', 'scheduled', 'live') then
        raise exception 'live session cannot be unpinned from status %', v_session.status;
    end if;

    delete from public.vendor_live_session_products
    where id = v_pin.id;

    perform public.write_vendor_audit_log(
        v_pin.vendor_id,
        'vendor_live_product_unpinned',
        'vendor_live_session_product',
        v_pin.id,
        jsonb_build_object(
            'live_session_id', v_pin.live_session_id,
            'vendor_product_id', v_pin.vendor_product_id,
            'session_status', v_session.status,
            'admin_cleanup', v_is_admin and v_session.status in ('ended', 'cancelled')
        )
    );

    return to_jsonb(v_pin);
end;
$$;

revoke all on function public.pin_vendor_live_product(uuid, uuid, integer) from public;
revoke all on function public.unpin_vendor_live_product(uuid, uuid) from public;

grant execute on function public.pin_vendor_live_product(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.unpin_vendor_live_product(uuid, uuid) to authenticated, service_role;
