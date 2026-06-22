-- Sinbad Core v0.2 — Commission Workflow V1
-- Migration 0005: audited commission status transitions
--
-- Scope guardrails:
--   * No Shopify publishing, webhook ingestion, dashboard, Flutter, or frontend.
--   * Vendors retain read-only commission access.
--   * Finance/Admin commission status changes must go through RPCs.
--   * Commission is calculated per order line item elsewhere; this migration
--     only controls status lifecycle.

-- ---------------------------------------------------------------------------
-- Prevent direct finance table updates.
-- Commission status transitions must go through the RPCs below.
-- ---------------------------------------------------------------------------
drop policy if exists vendor_commissions_update_finance on public.vendor_commissions;

-- ---------------------------------------------------------------------------
-- approve_commission: pending -> approved
-- ---------------------------------------------------------------------------
create or replace function public.approve_commission(
    commission_id uuid,
    notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_commission public.vendor_commissions;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.is_sinbad_finance() then
        raise exception 'finance role required';
    end if;

    select * into v_commission
    from public.vendor_commissions
    where id = commission_id
    for update;

    if v_commission.id is null then
        raise exception 'commission not found';
    end if;

    if v_commission.status = 'paid' then
        raise exception 'paid commission cannot be changed';
    end if;

    if v_commission.status = 'void' then
        raise exception 'void commission cannot be changed';
    end if;

    if v_commission.status <> 'pending' then
        raise exception 'commission cannot be approved from status %', v_commission.status;
    end if;

    update public.vendor_commissions
    set status = 'approved',
        approved_by = auth.uid(),
        approved_at = now()
    where id = commission_id
    returning * into v_commission;

    perform public.write_vendor_audit_log(
        v_commission.vendor_id,
        'commission_approved',
        'vendor_commission',
        v_commission.id,
        jsonb_build_object(
            'from_status', 'pending',
            'to_status', v_commission.status,
            'notes', notes
        )
    );

    return to_jsonb(v_commission);
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_commission_paid: approved -> paid
-- ---------------------------------------------------------------------------
create or replace function public.mark_commission_paid(
    commission_id uuid,
    notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_commission public.vendor_commissions;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.is_sinbad_finance() then
        raise exception 'finance role required';
    end if;

    select * into v_commission
    from public.vendor_commissions
    where id = commission_id
    for update;

    if v_commission.id is null then
        raise exception 'commission not found';
    end if;

    if v_commission.status = 'paid' then
        raise exception 'paid commission cannot be changed';
    end if;

    if v_commission.status = 'void' then
        raise exception 'void commission cannot be changed';
    end if;

    if v_commission.status <> 'approved' then
        raise exception 'commission cannot be marked paid from status %', v_commission.status;
    end if;

    update public.vendor_commissions
    set status = 'paid',
        paid_at = now()
    where id = commission_id
    returning * into v_commission;

    perform public.write_vendor_audit_log(
        v_commission.vendor_id,
        'commission_paid',
        'vendor_commission',
        v_commission.id,
        jsonb_build_object(
            'from_status', 'approved',
            'to_status', v_commission.status,
            'notes', notes
        )
    );

    return to_jsonb(v_commission);
end;
$$;

-- ---------------------------------------------------------------------------
-- void_commission: pending|approved -> void
-- ---------------------------------------------------------------------------
create or replace function public.void_commission(
    commission_id uuid,
    reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_commission public.vendor_commissions;
    v_from_status text;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.is_sinbad_finance() then
        raise exception 'finance role required';
    end if;

    if reason is null or length(trim(reason)) = 0 then
        raise exception 'void reason is required';
    end if;

    select * into v_commission
    from public.vendor_commissions
    where id = commission_id
    for update;

    if v_commission.id is null then
        raise exception 'commission not found';
    end if;

    if v_commission.status = 'paid' then
        raise exception 'paid commission cannot be changed';
    end if;

    if v_commission.status = 'void' then
        raise exception 'void commission cannot be changed';
    end if;

    if v_commission.status not in ('pending', 'approved') then
        raise exception 'commission cannot be voided from status %', v_commission.status;
    end if;

    v_from_status := v_commission.status;

    update public.vendor_commissions
    set status = 'void'
    where id = commission_id
    returning * into v_commission;

    perform public.write_vendor_audit_log(
        v_commission.vendor_id,
        'commission_voided',
        'vendor_commission',
        v_commission.id,
        jsonb_build_object(
            'from_status', v_from_status,
            'to_status', v_commission.status,
            'reason', trim(reason)
        )
    );

    return to_jsonb(v_commission);
end;
$$;

revoke all on function public.approve_commission(uuid, text) from public;
revoke all on function public.mark_commission_paid(uuid, text) from public;
revoke all on function public.void_commission(uuid, text) from public;

grant execute on function public.approve_commission(uuid, text) to authenticated, service_role;
grant execute on function public.mark_commission_paid(uuid, text) to authenticated, service_role;
grant execute on function public.void_commission(uuid, text) to authenticated, service_role;
