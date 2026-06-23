-- Sinbad Marketplace v0.2 — Product Review Workflow V2
-- Adds moderation statuses and review fields for product submissions.
-- Shopify publishing, category handling, barcode handling, and commissions are unchanged.

alter table public.vendor_product_submissions
    add column if not exists review_status text,
    add column if not exists review_reason text;

alter table public.vendor_product_submissions
    drop constraint if exists vendor_product_submissions_status_check,
    add constraint vendor_product_submissions_status_check
        check (status in (
            'draft',
            'submitted',
            'under_review',
            'changes_requested',
            'approved',
            'rejected',
            'published',
            'archived'
        ));

alter table public.vendor_product_submissions
    drop constraint if exists vendor_product_submissions_review_status_check,
    add constraint vendor_product_submissions_review_status_check
        check (
            review_status is null
            or review_status in (
                'submitted',
                'under_review',
                'changes_requested',
                'approved',
                'rejected'
            )
        );

update public.vendor_product_submissions
set review_status = status
where review_status is null
  and status in ('submitted', 'under_review', 'approved', 'rejected');

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

    if v_submission.status not in ('draft', 'rejected', 'changes_requested') then
        raise exception 'submission cannot be submitted from status %', v_submission.status;
    end if;

    if not public.submission_has_active_images(v_submission) then
        raise exception 'at least one active product image is required';
    end if;

    if not public.submission_has_category(v_submission) then
        raise exception 'category or suggested category is required';
    end if;

    update public.vendor_product_submissions
    set status = 'submitted',
        review_status = 'submitted',
        review_notes = null,
        review_reason = null,
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
        review_status = 'approved',
        review_reason = null,
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
        raise exception 'rejection reason is required';
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
        review_status = 'rejected',
        review_notes = null,
        review_reason = trim(p_review_notes),
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

create or replace function public.request_changes_product_submission(
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
        raise exception 'review note is required';
    end if;

    select * into v_submission
    from public.vendor_product_submissions
    where id = p_submission_id
    for update;

    if v_submission.id is null then
        raise exception 'submission not found';
    end if;

    if v_submission.status not in ('submitted', 'under_review') then
        raise exception 'submission cannot request changes from status %', v_submission.status;
    end if;

    update public.vendor_product_submissions
    set status = 'changes_requested',
        review_status = 'changes_requested',
        review_notes = trim(p_review_notes),
        review_reason = null,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_submission_id
    returning * into v_submission;

    perform public.write_vendor_audit_log(
        v_submission.vendor_id,
        'product_submission_changes_requested',
        'vendor_product_submission',
        v_submission.id,
        jsonb_build_object('status', v_submission.status)
    );

    return to_jsonb(v_submission);
end;
$$;

revoke all on function public.request_changes_product_submission(uuid, text) from public;
grant execute on function public.request_changes_product_submission(uuid, text)
    to authenticated, service_role;
