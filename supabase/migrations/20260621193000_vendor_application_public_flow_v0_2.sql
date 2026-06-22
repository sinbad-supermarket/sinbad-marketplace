-- Sinbad Core v0.2 — Vendor Application Public Flow V1
-- Private application document storage, controlled anonymous upload sessions,
-- public application submission with document IDs, and admin document review.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'vendor-application-documents',
    'vendor-application-documents',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.vendor_application_upload_sessions (
    id                 uuid primary key default gen_random_uuid(),
    upload_token       text not null unique default encode(gen_random_bytes(24), 'hex'),
    submitted_at       timestamptz,
    expires_at         timestamptz not null default (now() + interval '24 hours'),
    submitted_ip       text,
    submitted_user_agent text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint vendor_application_upload_sessions_token_length_check
        check (length(upload_token) >= 32)
);

drop trigger if exists vendor_application_upload_sessions_set_updated_at
    on public.vendor_application_upload_sessions;
create trigger vendor_application_upload_sessions_set_updated_at
    before update on public.vendor_application_upload_sessions
    for each row execute function public.set_updated_at();

create index if not exists vendor_application_upload_sessions_token_idx
    on public.vendor_application_upload_sessions (upload_token);
create index if not exists vendor_application_upload_sessions_expires_at_idx
    on public.vendor_application_upload_sessions (expires_at);

alter table public.vendor_application_upload_sessions enable row level security;

create or replace function public.is_valid_vendor_application_upload_session(
    p_upload_session_id uuid,
    p_upload_token text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.vendor_application_upload_sessions session
        where session.id = p_upload_session_id
          and session.upload_token = p_upload_token
          and session.submitted_at is null
          and session.expires_at > now()
    );
$$;

drop policy if exists vendor_application_upload_sessions_select_admin
    on public.vendor_application_upload_sessions;
create policy vendor_application_upload_sessions_select_admin
    on public.vendor_application_upload_sessions
    for select
    to authenticated
    using (public.is_sinbad_admin());

create table if not exists public.vendor_application_documents (
    id                 uuid primary key default gen_random_uuid(),
    application_id     uuid references public.vendor_applications(id) on delete cascade,
    upload_session_id  uuid references public.vendor_application_upload_sessions(id) on delete set null,
    upload_token       text,
    document_type      text not null check (document_type in ('trade_license', 'civil_id', 'store_logo')),
    storage_bucket     text not null default 'vendor-application-documents',
    storage_path       text not null,
    original_filename  text,
    content_type       text not null,
    file_size_bytes    integer not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
    status             text not null default 'active' check (status in ('active', 'removed')),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (storage_bucket, storage_path),
    constraint vendor_application_documents_bucket_check
        check (storage_bucket = 'vendor-application-documents'),
    constraint vendor_application_documents_content_type_check
        check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
    constraint vendor_application_documents_public_path_check
        check (
            storage_path like ('applications/' || upload_session_id::text || '/' || upload_token || '/%')
            or application_id is not null
        )
);

drop trigger if exists vendor_application_documents_set_updated_at
    on public.vendor_application_documents;
create trigger vendor_application_documents_set_updated_at
    before update on public.vendor_application_documents
    for each row execute function public.set_updated_at();

create unique index if not exists vendor_application_documents_active_type_idx
    on public.vendor_application_documents (application_id, document_type)
    where status = 'active' and application_id is not null;
create index if not exists vendor_application_documents_application_id_idx
    on public.vendor_application_documents (application_id);
create index if not exists vendor_application_documents_upload_session_idx
    on public.vendor_application_documents (upload_session_id);
create index if not exists vendor_application_documents_document_type_idx
    on public.vendor_application_documents (document_type);
create index if not exists vendor_application_documents_storage_path_idx
    on public.vendor_application_documents (storage_path);

alter table public.vendor_application_documents enable row level security;

drop policy if exists vendor_application_documents_select_admin
    on public.vendor_application_documents;
create policy vendor_application_documents_select_admin
    on public.vendor_application_documents
    for select
    to authenticated
    using (public.is_sinbad_admin());

drop policy if exists vendor_application_documents_insert_public_session
    on public.vendor_application_documents;
create policy vendor_application_documents_insert_public_session
    on public.vendor_application_documents
    for insert
    to anon, authenticated
    with check (
        application_id is null
        and status = 'active'
        and storage_bucket = 'vendor-application-documents'
        and public.is_valid_vendor_application_upload_session(upload_session_id, upload_token)
        and storage_path like ('applications/' || upload_session_id::text || '/' || upload_token || '/%')
    );

drop policy if exists vendor_application_documents_manage_admin
    on public.vendor_application_documents;
create policy vendor_application_documents_manage_admin
    on public.vendor_application_documents
    for all
    to authenticated
    using (public.is_sinbad_admin())
    with check (public.is_sinbad_admin());

create or replace function public.storage_application_upload_session_id_from_path(p_name text)
returns uuid
language plpgsql
stable
set search_path = public
as $$
begin
    if split_part(p_name, '/', 1) <> 'applications' then
        return null;
    end if;

    return split_part(p_name, '/', 2)::uuid;
exception when others then
    return null;
end;
$$;

create or replace function public.storage_application_upload_token_from_path(p_name text)
returns text
language sql
stable
set search_path = public
as $$
    select case
        when split_part(p_name, '/', 1) = 'applications' then split_part(p_name, '/', 3)
        else null
    end;
$$;

drop policy if exists vendor_application_documents_storage_select_admin
    on storage.objects;
create policy vendor_application_documents_storage_select_admin
    on storage.objects
    for select
    to authenticated
    using (
        bucket_id = 'vendor-application-documents'
        and public.is_sinbad_admin()
    );

drop policy if exists vendor_application_documents_storage_insert_public_session
    on storage.objects;
create policy vendor_application_documents_storage_insert_public_session
    on storage.objects
    for insert
    to anon, authenticated
    with check (
        bucket_id = 'vendor-application-documents'
        and split_part(name, '/', 1) = 'applications'
        and public.is_valid_vendor_application_upload_session(
            public.storage_application_upload_session_id_from_path(name),
            public.storage_application_upload_token_from_path(name)
        )
    );

drop policy if exists vendor_application_documents_storage_manage_admin
    on storage.objects;
create policy vendor_application_documents_storage_manage_admin
    on storage.objects
    for all
    to authenticated
    using (
        bucket_id = 'vendor-application-documents'
        and public.is_sinbad_admin()
    )
    with check (
        bucket_id = 'vendor-application-documents'
        and public.is_sinbad_admin()
    );

create or replace function public.create_vendor_application_upload_session(
    p_submitted_ip text default null,
    p_submitted_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.vendor_application_upload_sessions;
begin
    insert into public.vendor_application_upload_sessions (
        submitted_ip,
        submitted_user_agent
    )
    values (
        nullif(trim(coalesce(p_submitted_ip, '')), ''),
        nullif(trim(coalesce(p_submitted_user_agent, '')), '')
    )
    returning * into v_session;

    return jsonb_build_object(
        'id', v_session.id,
        'upload_token', v_session.upload_token,
        'expires_at', v_session.expires_at
    );
end;
$$;

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
    p_application_source text default null,
    p_document_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_application public.vendor_applications;
    v_document_ids uuid[] := coalesce(p_document_ids, '{}'::uuid[]);
    v_document_count integer;
    v_distinct_document_count integer;
    v_required_document_types text[] := array['trade_license', 'civil_id', 'store_logo'];
    v_missing_document_types text[];
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
        raise exception 'estimated product count must be greater than or equal to 0';
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
        raise exception 'IBAN is required';
    end if;
    if coalesce(p_accepted_commission, false) is distinct from true then
        raise exception '5 percent commission agreement is required';
    end if;
    if coalesce(p_accepted_sinbad_delivery, false) is distinct from true then
        raise exception 'Sinbad-managed delivery agreement is required';
    end if;

    if p_trade_license_file_url is not null
       or p_civil_id_file_url is not null
       or p_store_logo_file_url is not null then
        raise exception 'public vendor applications must use controlled document uploads';
    end if;

    if exists (
        select 1
        from public.vendor_applications existing
        where lower(existing.owner_email) = lower(trim(p_owner_email))
          and existing.status in ('new', 'under_review', 'needs_changes', 'approved')
    ) then
        raise exception 'an active vendor application already exists for this owner email';
    end if;

    if exists (
        select 1
        from public.vendor_applications existing
        where lower(existing.company_trade_name) = lower(trim(p_company_trade_name))
          and existing.status in ('new', 'under_review', 'needs_changes', 'approved')
    ) then
        raise exception 'an active vendor application already exists for this trade name';
    end if;

    select count(*), count(distinct document_id)
    into v_document_count, v_distinct_document_count
    from unnest(v_document_ids) as document_id;

    if v_document_count <> 3 then
        raise exception 'trade license, civil ID, and store logo uploads are required';
    end if;
    if v_document_count <> v_distinct_document_count then
        raise exception 'duplicate document IDs are not allowed';
    end if;

    select array_agg(required_type)
    into v_missing_document_types
    from unnest(v_required_document_types) as required_type
    where not exists (
        select 1
        from public.vendor_application_documents document
        join public.vendor_application_upload_sessions session
          on session.id = document.upload_session_id
        where document.id = any(v_document_ids)
          and document.document_type = required_type
          and document.application_id is null
          and document.status = 'active'
          and document.storage_bucket = 'vendor-application-documents'
          and session.upload_token = document.upload_token
          and session.submitted_at is null
          and session.expires_at > now()
    );

    if v_missing_document_types is not null then
        raise exception 'required document uploads are missing: %', array_to_string(v_missing_document_types, ', ');
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
        application_source
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
        trim(p_iban),
        null,
        null,
        null,
        true,
        true,
        nullif(trim(coalesce(p_submitted_ip, '')), ''),
        nullif(trim(coalesce(p_submitted_user_agent, '')), ''),
        nullif(trim(coalesce(p_application_source, '')), '')
    )
    returning * into v_application;

    update public.vendor_application_documents document
    set application_id = v_application.id
    where document.id = any(v_document_ids)
      and document.application_id is null
      and document.status = 'active';

    update public.vendor_application_upload_sessions session
    set submitted_at = now()
    where exists (
        select 1
        from public.vendor_application_documents document
        where document.upload_session_id = session.id
          and document.application_id = v_application.id
    );

    return to_jsonb(v_application);
end;
$$;

create or replace function public.application_has_required_documents(p_application public.vendor_applications)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select (
        (
            p_application.trade_license_file_url is not null
            and length(trim(p_application.trade_license_file_url)) > 0
        )
        or exists (
            select 1 from public.vendor_application_documents document
            where document.application_id = p_application.id
              and document.document_type = 'trade_license'
              and document.status = 'active'
        )
    )
    and (
        (
            p_application.civil_id_file_url is not null
            and length(trim(p_application.civil_id_file_url)) > 0
        )
        or exists (
            select 1 from public.vendor_application_documents document
            where document.application_id = p_application.id
              and document.document_type = 'civil_id'
              and document.status = 'active'
        )
    )
    and (
        (
            p_application.store_logo_file_url is not null
            and length(trim(p_application.store_logo_file_url)) > 0
        )
        or exists (
            select 1 from public.vendor_application_documents document
            where document.application_id = p_application.id
              and document.document_type = 'store_logo'
              and document.status = 'active'
        )
    );
$$;

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

    return to_jsonb(v_application);
end;
$$;

revoke all on function public.create_vendor_application_upload_session(text, text) from public;
revoke all on function public.is_valid_vendor_application_upload_session(uuid, text) from public;
revoke all on function public.submit_vendor_application(
    text, text, text, text, text, text, text, integer, text, text, text,
    text, text, text, text, text, text, boolean, boolean, text, text, text
) from anon, authenticated;
revoke all on function public.submit_vendor_application(
    text, text, text, text, text, text, text, integer, text, text, text,
    text, text, text, text, text, text, boolean, boolean, text, text, text, uuid[]
) from public;
revoke all on function public.application_has_required_documents(public.vendor_applications) from public;

grant execute on function public.create_vendor_application_upload_session(text, text)
    to anon, authenticated, service_role;
grant execute on function public.is_valid_vendor_application_upload_session(uuid, text)
    to anon, authenticated, service_role;
grant execute on function public.submit_vendor_application(
    text, text, text, text, text, text, text, integer, text, text, text,
    text, text, text, text, text, text, boolean, boolean, text, text, text, uuid[]
) to anon, authenticated, service_role;
grant execute on function public.application_has_required_documents(public.vendor_applications)
    to authenticated, service_role;
