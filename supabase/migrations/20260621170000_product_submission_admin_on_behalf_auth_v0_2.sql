-- Sinbad Core v0.2 — Product Submission Admin-on-Behalf Authorization
-- Migration 0009: tighten create/submit product submission RPC role checks
--
-- Scope guardrails:
--   * RPC authorization only.
--   * No Shopify changes.
--   * No dashboard/frontend changes.

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
    v_created_on_behalf_by_admin boolean;
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
        jsonb_build_object(
            'status', v_submission.status,
            'created_on_behalf_by_admin', v_created_on_behalf_by_admin
        )
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

revoke all on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer) from public;
revoke all on function public.submit_product_submission(uuid) from public;

grant execute on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer) to authenticated, service_role;
grant execute on function public.submit_product_submission(uuid) to authenticated, service_role;
