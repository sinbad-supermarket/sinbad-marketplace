-- Sinbad Core v0.2 — Vendor Owner Invite V1
-- Tracks and supports owner dashboard access after vendor application approval.

alter table public.vendor_applications
    add column if not exists owner_invite_status text not null default 'not_sent'
        check (owner_invite_status in ('not_sent', 'sent', 'accepted', 'failed')),
    add column if not exists owner_invited_at timestamptz,
    add column if not exists owner_invited_by uuid references auth.users(id) on delete set null,
    add column if not exists owner_invite_error text,
    add column if not exists owner_auth_user_id uuid references auth.users(id) on delete set null,
    add column if not exists owner_invite_attempt_count integer not null default 0
        check (owner_invite_attempt_count >= 0),
    add column if not exists owner_invite_last_attempt_at timestamptz,
    add column if not exists owner_invite_email text,
    add column if not exists owner_invite_redirect_url text;

create index if not exists vendor_applications_owner_invite_status_idx
    on public.vendor_applications (owner_invite_status);
create index if not exists vendor_applications_owner_auth_user_id_idx
    on public.vendor_applications (owner_auth_user_id);
create index if not exists vendor_applications_owner_invited_by_idx
    on public.vendor_applications (owner_invited_by);

create or replace function public.approve_vendor_application(
    application_id uuid,
    notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.vendor_applications;
    v_vendor public.vendors;
    v_vendor_user public.vendor_users;
    v_owner_user_id uuid;
    v_slug_base text;
    v_slug text;
    v_suffix integer := 0;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;
    if not public.is_sinbad_reviewer() then
        raise exception 'reviewer role required';
    end if;

    select * into v_application
    from public.vendor_applications
    where id = application_id
    for update;

    if v_application.id is null then
        raise exception 'vendor application not found';
    end if;
    if v_application.status in ('approved', 'rejected') then
        raise exception 'application cannot be approved from status %', v_application.status;
    end if;
    if v_application.accepted_commission is distinct from true then
        raise exception '5 percent commission agreement is required before approval';
    end if;
    if v_application.accepted_sinbad_delivery is distinct from true then
        raise exception 'Sinbad-managed delivery agreement is required before approval';
    end if;
    if not public.application_has_required_documents(v_application) then
        raise exception 'trade license, ID/civil ID, and store logo uploads are required before approval';
    end if;

    v_slug_base := regexp_replace(lower(trim(v_application.company_trade_name)), '[^a-z0-9]+', '-', 'g');
    v_slug_base := trim(both '-' from v_slug_base);
    if v_slug_base = '' then
        v_slug_base := 'vendor';
    end if;
    v_slug := v_slug_base;

    while exists (select 1 from public.vendors where slug = v_slug) loop
        v_suffix := v_suffix + 1;
        v_slug := v_slug_base || '-' || v_suffix::text;
    end loop;

    insert into public.vendors (
        name,
        slug,
        status,
        default_commission_rate
    )
    values (
        v_application.company_trade_name,
        v_slug,
        'active',
        0.0500
    )
    returning * into v_vendor;

    select id into v_owner_user_id
    from auth.users
    where lower(email) = lower(v_application.owner_email)
    order by created_at asc
    limit 1;

    if v_owner_user_id is not null then
        insert into public.vendor_users (
            vendor_id,
            user_id,
            role,
            status
        )
        values (
            v_vendor.id,
            v_owner_user_id,
            'owner',
            'active'
        )
        on conflict (vendor_id, user_id) do update
        set role = 'owner',
            status = 'active'
        returning * into v_vendor_user;
    end if;

    update public.vendor_applications
    set status = 'approved',
        review_notes = nullif(trim(coalesce(notes, '')), ''),
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        approved_vendor_id = v_vendor.id,
        created_vendor_user_id = v_vendor_user.id,
        owner_auth_user_id = v_owner_user_id,
        owner_invite_status = case
            when v_owner_user_id is not null then 'accepted'
            else owner_invite_status
        end,
        owner_invite_email = lower(owner_email),
        owner_invite_error = null
    where id = application_id
    returning * into v_application;

    perform public.write_vendor_audit_log(
        v_vendor.id,
        'vendor_application_approved',
        'vendor_application',
        v_application.id,
        jsonb_build_object(
            'vendor_id', v_vendor.id,
            'vendor_user_id', v_vendor_user.id,
            'owner_user_linked', v_owner_user_id is not null,
            'notes', notes
        )
    );

    return to_jsonb(v_application);
end;
$$;
