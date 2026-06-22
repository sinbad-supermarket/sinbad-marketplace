-- Sinbad Core v0.2 — Multi-Vendor RLS + Workflows
-- Migration 0004: role-aware helpers, RLS policies, workflow RPCs, audit support
--
-- Scope guardrails:
--   * No Shopify publishing, webhook ingestion, dashboard, Flutter, or frontend.
--   * Product approval does not publish to Shopify.
--   * Vendors cannot publish products or mutate commissions/orders directly.
--   * Service role remains reserved for later trusted integrations.

-- V1 business freeze: default commission rate is 5%.
alter table public.vendors
    alter column default_commission_rate set default 0.0500;

-- ---------------------------------------------------------------------------
-- Role-aware helper functions
-- ---------------------------------------------------------------------------
create or replace function public.has_sinbad_admin_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.admin_users
        where user_id = auth.uid()
          and active = true
          and role = any(p_roles)
    );
$$;

create or replace function public.is_sinbad_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.has_sinbad_admin_role(array['owner', 'admin', 'reviewer', 'finance']);
$$;

create or replace function public.is_sinbad_owner_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.has_sinbad_admin_role(array['owner', 'admin']);
$$;

create or replace function public.is_sinbad_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.has_sinbad_admin_role(array['owner', 'admin', 'reviewer']);
$$;

create or replace function public.is_sinbad_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.has_sinbad_admin_role(array['owner', 'admin', 'finance']);
$$;

create or replace function public.is_vendor_member(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.vendor_users
        where vendor_id = p_vendor_id
          and user_id = auth.uid()
          and status = 'active'
    );
$$;

create or replace function public.is_vendor_owner(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.vendor_users
        where vendor_id = p_vendor_id
          and user_id = auth.uid()
          and role = 'owner'
          and status = 'active'
    );
$$;

create or replace function public.is_vendor_staff_or_owner(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.vendor_users
        where vendor_id = p_vendor_id
          and user_id = auth.uid()
          and role in ('owner', 'staff')
          and status = 'active'
    );
$$;

create or replace function public.current_user_vendor_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(array_agg(vendor_id), '{}'::uuid[])
    from public.vendor_users
    where user_id = auth.uid()
      and status = 'active';
$$;

create or replace function public.write_vendor_audit_log(
    p_vendor_id uuid,
    p_action text,
    p_entity_type text,
    p_entity_id uuid,
    p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor_type text;
    v_audit_id bigint;
begin
    if auth.uid() is null then
        v_actor_type := 'system';
    elsif public.is_sinbad_admin() then
        v_actor_type := 'sinbad_admin';
    elsif p_vendor_id is not null and public.is_vendor_owner(p_vendor_id) then
        v_actor_type := 'vendor_owner';
    elsif p_vendor_id is not null and public.is_vendor_member(p_vendor_id) then
        v_actor_type := 'vendor_staff';
    else
        v_actor_type := 'system';
    end if;

    insert into public.vendor_audit_logs (
        vendor_id,
        actor_user_id,
        actor_type,
        action,
        entity_type,
        entity_id,
        metadata
    )
    values (
        p_vendor_id,
        auth.uid(),
        v_actor_type,
        p_action,
        p_entity_type,
        p_entity_id,
        coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_audit_id;

    return v_audit_id;
end;
$$;

revoke all on function public.has_sinbad_admin_role(text[]) from public;
revoke all on function public.is_sinbad_admin() from public;
revoke all on function public.is_sinbad_owner_or_admin() from public;
revoke all on function public.is_sinbad_reviewer() from public;
revoke all on function public.is_sinbad_finance() from public;
revoke all on function public.is_vendor_member(uuid) from public;
revoke all on function public.is_vendor_owner(uuid) from public;
revoke all on function public.is_vendor_staff_or_owner(uuid) from public;
revoke all on function public.current_user_vendor_ids() from public;
revoke all on function public.write_vendor_audit_log(uuid, text, text, uuid, jsonb) from public;
revoke all on function public.write_vendor_audit_log(uuid, text, text, uuid, jsonb) from anon;
revoke all on function public.write_vendor_audit_log(uuid, text, text, uuid, jsonb) from authenticated;

grant execute on function public.has_sinbad_admin_role(text[]) to authenticated, service_role;
grant execute on function public.is_sinbad_admin() to authenticated, service_role;
grant execute on function public.is_sinbad_owner_or_admin() to authenticated, service_role;
grant execute on function public.is_sinbad_reviewer() to authenticated, service_role;
grant execute on function public.is_sinbad_finance() to authenticated, service_role;
grant execute on function public.is_vendor_member(uuid) to authenticated, service_role;
grant execute on function public.is_vendor_owner(uuid) to authenticated, service_role;
grant execute on function public.is_vendor_staff_or_owner(uuid) to authenticated, service_role;
grant execute on function public.current_user_vendor_ids() to authenticated, service_role;
grant execute on function public.write_vendor_audit_log(uuid, text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
drop policy if exists admin_users_select_admin on public.admin_users;
create policy admin_users_select_admin
    on public.admin_users
    for select
    to authenticated
    using (public.is_sinbad_admin());

drop policy if exists admin_users_insert_owner_admin on public.admin_users;
create policy admin_users_insert_owner_admin
    on public.admin_users
    for insert
    to authenticated
    with check (public.is_sinbad_owner_or_admin());

drop policy if exists admin_users_update_owner_admin on public.admin_users;
create policy admin_users_update_owner_admin
    on public.admin_users
    for update
    to authenticated
    using (public.is_sinbad_owner_or_admin())
    with check (public.is_sinbad_owner_or_admin());

drop policy if exists admin_users_delete_owner_admin on public.admin_users;
create policy admin_users_delete_owner_admin
    on public.admin_users
    for delete
    to authenticated
    using (public.is_sinbad_owner_or_admin());

drop policy if exists vendors_select_admin_or_member on public.vendors;
create policy vendors_select_admin_or_member
    on public.vendors
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(id));

drop policy if exists vendors_insert_owner_admin on public.vendors;
create policy vendors_insert_owner_admin
    on public.vendors
    for insert
    to authenticated
    with check (public.is_sinbad_owner_or_admin());

drop policy if exists vendors_update_owner_admin on public.vendors;
create policy vendors_update_owner_admin
    on public.vendors
    for update
    to authenticated
    using (public.is_sinbad_owner_or_admin())
    with check (public.is_sinbad_owner_or_admin());

drop policy if exists vendor_users_select_admin_or_same_vendor on public.vendor_users;
create policy vendor_users_select_admin_or_same_vendor
    on public.vendor_users
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_users_insert_admin_or_owner on public.vendor_users;
create policy vendor_users_insert_admin_or_owner
    on public.vendor_users
    for insert
    to authenticated
    with check (public.is_sinbad_owner_or_admin() or public.is_vendor_owner(vendor_id));

drop policy if exists vendor_users_update_admin_or_owner on public.vendor_users;
create policy vendor_users_update_admin_or_owner
    on public.vendor_users
    for update
    to authenticated
    using (public.is_sinbad_owner_or_admin() or public.is_vendor_owner(vendor_id))
    with check (public.is_sinbad_owner_or_admin() or public.is_vendor_owner(vendor_id));

drop policy if exists vendor_product_submissions_select_admin_or_vendor on public.vendor_product_submissions;
create policy vendor_product_submissions_select_admin_or_vendor
    on public.vendor_product_submissions
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_product_submissions_insert_admin_or_vendor on public.vendor_product_submissions;
create policy vendor_product_submissions_insert_admin_or_vendor
    on public.vendor_product_submissions
    for insert
    to authenticated
    with check (
        public.is_sinbad_admin()
        or (
            public.is_vendor_staff_or_owner(vendor_id)
            and status = 'draft'
            and submitted_by = auth.uid()
            and reviewed_by is null
            and reviewed_at is null
        )
    );

drop policy if exists vendor_product_submissions_update_admin_or_vendor_draft on public.vendor_product_submissions;
create policy vendor_product_submissions_update_admin_or_vendor_draft
    on public.vendor_product_submissions
    for update
    to authenticated
    using (
        public.is_sinbad_admin()
        or (
            public.is_vendor_staff_or_owner(vendor_id)
            and status in ('draft', 'rejected')
        )
    )
    with check (
        public.is_sinbad_admin()
        or (
            public.is_vendor_staff_or_owner(vendor_id)
            and status in ('draft', 'submitted')
            and reviewed_by is null
            and reviewed_at is null
        )
    );

drop policy if exists vendor_products_select_admin_or_vendor on public.vendor_products;
create policy vendor_products_select_admin_or_vendor
    on public.vendor_products
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_products_write_owner_admin on public.vendor_products;
create policy vendor_products_write_owner_admin
    on public.vendor_products
    for all
    to authenticated
    using (public.is_sinbad_owner_or_admin())
    with check (public.is_sinbad_owner_or_admin());

drop policy if exists vendor_orders_select_admin_or_vendor on public.vendor_orders;
create policy vendor_orders_select_admin_or_vendor
    on public.vendor_orders
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_orders_update_owner_admin_finance on public.vendor_orders;
create policy vendor_orders_update_owner_admin_finance
    on public.vendor_orders
    for update
    to authenticated
    using (public.is_sinbad_finance())
    with check (public.is_sinbad_finance());

drop policy if exists vendor_order_items_select_admin_or_vendor on public.vendor_order_items;
create policy vendor_order_items_select_admin_or_vendor
    on public.vendor_order_items
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_commissions_select_admin_or_vendor on public.vendor_commissions;
create policy vendor_commissions_select_admin_or_vendor
    on public.vendor_commissions
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_commissions_update_finance on public.vendor_commissions;
create policy vendor_commissions_update_finance
    on public.vendor_commissions
    for update
    to authenticated
    using (public.is_sinbad_finance())
    with check (public.is_sinbad_finance());

drop policy if exists vendor_live_sessions_select_admin_or_vendor on public.vendor_live_sessions;
create policy vendor_live_sessions_select_admin_or_vendor
    on public.vendor_live_sessions
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_live_sessions_insert_admin_or_vendor on public.vendor_live_sessions;
create policy vendor_live_sessions_insert_admin_or_vendor
    on public.vendor_live_sessions
    for insert
    to authenticated
    with check (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(vendor_id));

drop policy if exists vendor_live_sessions_update_admin_or_vendor on public.vendor_live_sessions;
create policy vendor_live_sessions_update_admin_or_vendor
    on public.vendor_live_sessions
    for update
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(vendor_id))
    with check (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(vendor_id));

drop policy if exists vendor_live_session_products_select_admin_or_vendor on public.vendor_live_session_products;
create policy vendor_live_session_products_select_admin_or_vendor
    on public.vendor_live_session_products
    for select
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_member(vendor_id));

drop policy if exists vendor_live_session_products_insert_admin_or_vendor on public.vendor_live_session_products;
create policy vendor_live_session_products_insert_admin_or_vendor
    on public.vendor_live_session_products
    for insert
    to authenticated
    with check (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(vendor_id));

drop policy if exists vendor_live_session_products_delete_admin_or_vendor on public.vendor_live_session_products;
create policy vendor_live_session_products_delete_admin_or_vendor
    on public.vendor_live_session_products
    for delete
    to authenticated
    using (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(vendor_id));

drop policy if exists vendor_audit_logs_select_admin_or_vendor on public.vendor_audit_logs;
create policy vendor_audit_logs_select_admin_or_vendor
    on public.vendor_audit_logs
    for select
    to authenticated
    using (public.is_sinbad_admin() or (vendor_id is not null and public.is_vendor_member(vendor_id)));

drop policy if exists vendor_audit_logs_insert_admin_or_vendor on public.vendor_audit_logs;

-- ---------------------------------------------------------------------------
-- Workflow RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_product_submission(
    p_vendor_id uuid,
    p_title text,
    p_description text default null,
    p_images jsonb default '[]'::jsonb,
    p_price numeric default null,
    p_sku text default null,
    p_inventory_quantity integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_submission public.vendor_product_submissions;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(p_vendor_id)) then
        raise exception 'not authorized for vendor';
    end if;

    if p_title is null or length(trim(p_title)) = 0 then
        raise exception 'title is required';
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

    perform public.write_vendor_audit_log(
        v_submission.vendor_id,
        'product_submission_created',
        'vendor_product_submission',
        v_submission.id,
        jsonb_build_object('status', v_submission.status)
    );

    return to_jsonb(v_submission);
end;
$$;

create or replace function public.submit_product_submission(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_submission public.vendor_product_submissions;
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

    if not public.is_vendor_staff_or_owner(v_submission.vendor_id) then
        raise exception 'not authorized for vendor';
    end if;

    if v_submission.status not in ('draft', 'rejected') then
        raise exception 'submission cannot be submitted from status %', v_submission.status;
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
        jsonb_build_object('status', v_submission.status)
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

create or replace function public.reject_product_submission(
    p_submission_id uuid,
    p_review_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_submission public.vendor_product_submissions;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not public.is_sinbad_reviewer() then
        raise exception 'reviewer role required';
    end if;

    if p_review_notes is null or length(trim(p_review_notes)) = 0 then
        raise exception 'review notes are required';
    end if;

    select * into v_submission
    from public.vendor_product_submissions
    where id = p_submission_id
    for update;

    if v_submission.id is null then
        raise exception 'submission not found';
    end if;

    if v_submission.status not in ('submitted', 'under_review') then
        raise exception 'submission cannot be rejected from status %', v_submission.status;
    end if;

    update public.vendor_product_submissions
    set status = 'rejected',
        review_notes = trim(p_review_notes),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_submission_id
    returning * into v_submission;

    perform public.write_vendor_audit_log(
        v_submission.vendor_id,
        'product_submission_rejected',
        'vendor_product_submission',
        v_submission.id,
        jsonb_build_object('status', v_submission.status)
    );

    return to_jsonb(v_submission);
end;
$$;

create or replace function public.create_vendor_live_session(
    p_vendor_id uuid,
    p_title text,
    p_starts_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.vendor_live_sessions;
begin
    if auth.uid() is null then
        raise exception 'authentication required';
    end if;

    if not (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(p_vendor_id)) then
        raise exception 'not authorized for vendor';
    end if;

    if p_title is null or length(trim(p_title)) = 0 then
        raise exception 'title is required';
    end if;

    insert into public.vendor_live_sessions (
        vendor_id,
        title,
        status,
        starts_at,
        created_by
    )
    values (
        p_vendor_id,
        trim(p_title),
        case when p_starts_at is null then 'draft' else 'scheduled' end,
        p_starts_at,
        auth.uid()
    )
    returning * into v_session;

    perform public.write_vendor_audit_log(
        v_session.vendor_id,
        'vendor_live_session_created',
        'vendor_live_session',
        v_session.id,
        jsonb_build_object('status', v_session.status)
    );

    return to_jsonb(v_session);
end;
$$;

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
            'position', v_pin.position
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

    if not (public.is_sinbad_admin() or public.is_vendor_staff_or_owner(v_pin.vendor_id)) then
        raise exception 'not authorized for vendor';
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
            'vendor_product_id', v_pin.vendor_product_id
        )
    );

    return to_jsonb(v_pin);
end;
$$;

revoke all on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer) from public;
revoke all on function public.submit_product_submission(uuid) from public;
revoke all on function public.approve_product_submission(uuid) from public;
revoke all on function public.reject_product_submission(uuid, text) from public;
revoke all on function public.create_vendor_live_session(uuid, text, timestamptz) from public;
revoke all on function public.pin_vendor_live_product(uuid, uuid, integer) from public;
revoke all on function public.unpin_vendor_live_product(uuid, uuid) from public;

grant execute on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer) to authenticated, service_role;
grant execute on function public.submit_product_submission(uuid) to authenticated, service_role;
grant execute on function public.approve_product_submission(uuid) to authenticated, service_role;
grant execute on function public.reject_product_submission(uuid, text) to authenticated, service_role;
grant execute on function public.create_vendor_live_session(uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.pin_vendor_live_product(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.unpin_vendor_live_product(uuid, uuid) to authenticated, service_role;
