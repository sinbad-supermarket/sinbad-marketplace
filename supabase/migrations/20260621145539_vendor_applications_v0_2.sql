-- Sinbad Core v0.2 — Vendor Applications V1
-- Migration 0006: vendor application intake + review workflow
--
-- Scope guardrails:
--   * No dashboard/frontend, Shopify, Flutter, deploy, or remote work.
--   * Vendors cannot gain dashboard access from application submission alone.
--   * Vendor accounts and owner access are created only after approval.
--   * Dashboard language remains English-only in V1.

-- ---------------------------------------------------------------------------
-- vendor_applications: public intake, Sinbad-reviewed vendor onboarding queue
-- ---------------------------------------------------------------------------
create table if not exists public.vendor_applications (
    id                         uuid        primary key default gen_random_uuid(),
    status                     text        not null default 'new'
                                                check (status in ('new', 'under_review', 'needs_changes', 'approved', 'rejected')),

    company_legal_name         text        not null,
    company_trade_name         text        not null,
    license_number             text,

    owner_full_name            text        not null,
    owner_phone                text        not null,
    owner_email                text        not null,

    business_category          text        not null,
    estimated_product_count    integer     not null check (estimated_product_count >= 0),
    store_description          text        not null,

    pickup_address             text        not null,
    city_area                  text        not null,

    bank_name                  text        not null,
    account_holder_name        text        not null,
    iban                       text        not null,

    trade_license_file_url     text,
    civil_id_file_url          text,
    store_logo_file_url        text,

    accepted_commission        boolean     not null default false,
    accepted_sinbad_delivery   boolean     not null default false,

    review_notes               text,
    needs_changes_notes        text,
    rejection_reason           text,
    reviewed_by                uuid        references auth.users(id) on delete set null,
    reviewed_at                timestamptz,

    approved_vendor_id         uuid        references public.vendors(id) on delete set null,
    created_vendor_user_id     uuid        references public.vendor_users(id) on delete set null,

    submitted_ip               text,
    submitted_user_agent       text,
    application_source         text,

    created_at                 timestamptz not null default now(),
    updated_at                 timestamptz not null default now()
);

drop trigger if exists vendor_applications_set_updated_at on public.vendor_applications;
create trigger vendor_applications_set_updated_at
    before update on public.vendor_applications
    for each row execute function public.set_updated_at();

create index if not exists vendor_applications_status_idx
    on public.vendor_applications (status);
create index if not exists vendor_applications_owner_email_idx
    on public.vendor_applications (lower(owner_email));
create index if not exists vendor_applications_created_at_idx
    on public.vendor_applications (created_at);
create index if not exists vendor_applications_reviewed_by_idx
    on public.vendor_applications (reviewed_by);
create index if not exists vendor_applications_reviewed_at_idx
    on public.vendor_applications (reviewed_at);
create index if not exists vendor_applications_approved_vendor_id_idx
    on public.vendor_applications (approved_vendor_id);
create index if not exists vendor_applications_status_created_at_idx
    on public.vendor_applications (status, created_at);

alter table public.vendor_applications enable row level security;

-- Direct public/anonymous inserts are intentionally not allowed. Submission is
-- exposed only through submit_vendor_application().
drop policy if exists vendor_applications_select_admin on public.vendor_applications;
create policy vendor_applications_select_admin
    on public.vendor_applications
    for select
    to authenticated
    using (public.is_sinbad_admin());

-- ---------------------------------------------------------------------------
-- submit_vendor_application: public RPC-only intake
-- ---------------------------------------------------------------------------
create or replace function public.submit_vendor_application(
    p_company_legal_name text,
    p_company_trade_name text,
    p_license_number text default null,
    p_owner_full_name text default null,
    p_owner_phone text default null,
    p_owner_email text default null,
    p_business_category text default null,
    p_estimated_product_count integer default null,
    p_store_description text default null,
    p_pickup_address text default null,
    p_city_area text default null,
    p_bank_name text default null,
    p_account_holder_name text default null,
    p_iban text default null,
    p_trade_license_file_url text default null,
    p_civil_id_file_url text default null,
    p_store_logo_file_url text default null,
    p_accepted_commission boolean default false,
    p_accepted_sinbad_delivery boolean default false,
    p_submitted_ip text default null,
    p_submitted_user_agent text default null,
    p_application_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.vendor_applications;
begin
    if p_company_legal_name is null or length(trim(p_company_legal_name)) = 0 then
        raise exception 'company legal name is required';
    end if;
    if p_company_trade_name is null or length(trim(p_company_trade_name)) = 0 then
        raise exception 'company trade name is required';
    end if;
    if p_owner_full_name is null or length(trim(p_owner_full_name)) = 0 then
        raise exception 'owner full name is required';
    end if;
    if p_owner_phone is null or length(trim(p_owner_phone)) = 0 then
        raise exception 'owner phone is required';
    end if;
    if p_owner_email is null or length(trim(p_owner_email)) = 0 then
        raise exception 'owner email is required';
    end if;
    if position('@' in p_owner_email) <= 1 then
        raise exception 'valid owner email is required';
    end if;
    if p_business_category is null or length(trim(p_business_category)) = 0 then
        raise exception 'business category is required';
    end if;
    if p_estimated_product_count is null or p_estimated_product_count < 0 then
        raise exception 'estimated product count must be zero or greater';
    end if;
    if p_store_description is null or length(trim(p_store_description)) = 0 then
        raise exception 'store description is required';
    end if;
    if p_pickup_address is null or length(trim(p_pickup_address)) = 0 then
        raise exception 'pickup address is required';
    end if;
    if p_city_area is null or length(trim(p_city_area)) = 0 then
        raise exception 'city/area is required';
    end if;
    if p_bank_name is null or length(trim(p_bank_name)) = 0 then
        raise exception 'bank name is required';
    end if;
    if p_account_holder_name is null or length(trim(p_account_holder_name)) = 0 then
        raise exception 'account holder name is required';
    end if;
    if p_iban is null or length(trim(p_iban)) = 0 then
        raise exception 'iban is required';
    end if;
    if p_accepted_commission is distinct from true then
        raise exception '5 percent commission agreement is required';
    end if;
    if p_accepted_sinbad_delivery is distinct from true then
        raise exception 'Sinbad-managed delivery agreement is required';
    end if;

    insert into public.vendor_applications (
        company_legal_name,
        company_trade_name,
        license_number,
        owner_full_name,
        owner_phone,
        owner_email,
        business_category,
        estimated_product_count,
        store_description,
        pickup_address,
        city_area,
        bank_name,
        account_holder_name,
        iban,
        trade_license_file_url,
        civil_id_file_url,
        store_logo_file_url,
        accepted_commission,
        accepted_sinbad_delivery,
        submitted_ip,
        submitted_user_agent,
        application_source,
        status
    )
    values (
        trim(p_company_legal_name),
        trim(p_company_trade_name),
        nullif(trim(coalesce(p_license_number, '')), ''),
        trim(p_owner_full_name),
        trim(p_owner_phone),
        lower(trim(p_owner_email)),
        trim(p_business_category),
        p_estimated_product_count,
        trim(p_store_description),
        trim(p_pickup_address),
        trim(p_city_area),
        trim(p_bank_name),
        trim(p_account_holder_name),
        upper(replace(trim(p_iban), ' ', '')),
        nullif(trim(coalesce(p_trade_license_file_url, '')), ''),
        nullif(trim(coalesce(p_civil_id_file_url, '')), ''),
        nullif(trim(coalesce(p_store_logo_file_url, '')), ''),
        p_accepted_commission,
        p_accepted_sinbad_delivery,
        nullif(trim(coalesce(p_submitted_ip, '')), ''),
        nullif(trim(coalesce(p_submitted_user_agent, '')), ''),
        nullif(trim(coalesce(p_application_source, '')), ''),
        'new'
    )
    returning * into v_application;

    perform public.write_vendor_audit_log(
        null,
        'vendor_application_submitted',
        'vendor_application',
        v_application.id,
        jsonb_build_object(
            'status', v_application.status,
            'owner_email', v_application.owner_email,
            'company_trade_name', v_application.company_trade_name
        )
    );

    return jsonb_build_object(
        'id', v_application.id,
        'status', v_application.status,
        'created_at', v_application.created_at
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_vendor_application_under_review: new|needs_changes -> under_review
-- ---------------------------------------------------------------------------
create or replace function public.mark_vendor_application_under_review(application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.vendor_applications;
    v_from_status text;
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
        raise exception 'application cannot be reviewed from status %', v_application.status;
    end if;

    v_from_status := v_application.status;

    update public.vendor_applications
    set status = 'under_review',
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = application_id
    returning * into v_application;

    perform public.write_vendor_audit_log(
        null,
        'vendor_application_under_review',
        'vendor_application',
        v_application.id,
        jsonb_build_object('from_status', v_from_status, 'to_status', v_application.status)
    );

    return to_jsonb(v_application);
end;
$$;

-- ---------------------------------------------------------------------------
-- request_vendor_application_changes: active review state -> needs_changes
-- ---------------------------------------------------------------------------
create or replace function public.request_vendor_application_changes(
    application_id uuid,
    notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.vendor_applications;
    v_from_status text;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;
    if not public.is_sinbad_reviewer() then
        raise exception 'reviewer role required';
    end if;
    if notes is null or length(trim(notes)) = 0 then
        raise exception 'needs changes notes are required';
    end if;

    select * into v_application
    from public.vendor_applications
    where id = application_id
    for update;

    if v_application.id is null then
        raise exception 'vendor application not found';
    end if;
    if v_application.status not in ('new', 'under_review', 'needs_changes') then
        raise exception 'application cannot request changes from status %', v_application.status;
    end if;

    v_from_status := v_application.status;

    update public.vendor_applications
    set status = 'needs_changes',
        needs_changes_notes = trim(notes),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = application_id
    returning * into v_application;

    perform public.write_vendor_audit_log(
        null,
        'vendor_application_needs_changes',
        'vendor_application',
        v_application.id,
        jsonb_build_object(
            'from_status', v_from_status,
            'to_status', v_application.status,
            'notes', trim(notes)
        )
    );

    return to_jsonb(v_application);
end;
$$;

-- ---------------------------------------------------------------------------
-- approve_vendor_application: create vendor + owner access when possible
-- ---------------------------------------------------------------------------
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
    if v_application.trade_license_file_url is null or length(trim(v_application.trade_license_file_url)) = 0 then
        raise exception 'trade license upload is required before approval';
    end if;
    if v_application.civil_id_file_url is null or length(trim(v_application.civil_id_file_url)) = 0 then
        raise exception 'ID/civil ID upload is required before approval';
    end if;
    if v_application.store_logo_file_url is null or length(trim(v_application.store_logo_file_url)) = 0 then
        raise exception 'store logo upload is required before approval';
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
        created_vendor_user_id = v_vendor_user.id
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

    return jsonb_build_object(
        'application', to_jsonb(v_application),
        'vendor', to_jsonb(v_vendor),
        'vendor_user', case when v_vendor_user.id is null then null else to_jsonb(v_vendor_user) end
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- reject_vendor_application: active review state -> rejected
-- ---------------------------------------------------------------------------
create or replace function public.reject_vendor_application(
    application_id uuid,
    reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.vendor_applications;
    v_from_status text;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;
    if not public.is_sinbad_reviewer() then
        raise exception 'reviewer role required';
    end if;
    if reason is null or length(trim(reason)) = 0 then
        raise exception 'rejection reason is required';
    end if;

    select * into v_application
    from public.vendor_applications
    where id = application_id
    for update;

    if v_application.id is null then
        raise exception 'vendor application not found';
    end if;
    if v_application.status in ('approved', 'rejected') then
        raise exception 'application cannot be rejected from status %', v_application.status;
    end if;

    v_from_status := v_application.status;

    update public.vendor_applications
    set status = 'rejected',
        rejection_reason = trim(reason),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = application_id
    returning * into v_application;

    perform public.write_vendor_audit_log(
        null,
        'vendor_application_rejected',
        'vendor_application',
        v_application.id,
        jsonb_build_object(
            'from_status', v_from_status,
            'to_status', v_application.status,
            'reason', trim(reason)
        )
    );

    return to_jsonb(v_application);
end;
$$;

revoke all on function public.submit_vendor_application(
    text, text, text, text, text, text, text, integer, text, text, text,
    text, text, text, text, text, text, boolean, boolean, text, text, text
) from public;
revoke all on function public.mark_vendor_application_under_review(uuid) from public;
revoke all on function public.request_vendor_application_changes(uuid, text) from public;
revoke all on function public.approve_vendor_application(uuid, text) from public;
revoke all on function public.reject_vendor_application(uuid, text) from public;

grant execute on function public.submit_vendor_application(
    text, text, text, text, text, text, text, integer, text, text, text,
    text, text, text, text, text, text, boolean, boolean, text, text, text
) to anon, authenticated, service_role;
grant execute on function public.mark_vendor_application_under_review(uuid) to authenticated, service_role;
grant execute on function public.request_vendor_application_changes(uuid, text) to authenticated, service_role;
grant execute on function public.approve_vendor_application(uuid, text) to authenticated, service_role;
grant execute on function public.reject_vendor_application(uuid, text) to authenticated, service_role;
