-- Sinbad Core v0.2 — Marketplace API Grants
-- Grants base table/API privileges required for PostgREST to evaluate RLS.
-- RLS policies remain the security boundary; this migration does not broaden
-- policies or add Shopify/catalog behavior.

grant usage on schema public to anon, authenticated, service_role;

-- Protected marketplace tables: grant table privileges so PostgREST can reach
-- RLS. Anonymous select remains blocked by existing RLS policies.
grant select on table
    public.admin_users,
    public.vendors,
    public.vendor_users,
    public.vendor_applications,
    public.vendor_application_documents,
    public.vendor_product_submissions,
    public.vendor_product_submission_images,
    public.vendor_products,
    public.vendor_orders,
    public.vendor_order_items,
    public.vendor_commissions,
    public.vendor_live_sessions,
    public.vendor_live_session_products,
    public.vendor_product_publish_attempts,
    public.vendor_audit_logs
to anon, authenticated, service_role;

grant insert, update, delete on table
    public.admin_users,
    public.vendors,
    public.vendor_users,
    public.vendor_applications,
    public.vendor_application_documents,
    public.vendor_product_submissions,
    public.vendor_product_submission_images,
    public.vendor_products,
    public.vendor_orders,
    public.vendor_order_items,
    public.vendor_commissions,
    public.vendor_live_sessions,
    public.vendor_live_session_products,
    public.vendor_product_publish_attempts,
    public.vendor_audit_logs
to authenticated, service_role;

-- Public vendor application document uploads insert metadata directly, but only
-- when existing RLS upload-session checks pass.
grant insert on table public.vendor_application_documents to anon;

-- Application upload sessions are used by public RPCs and admin review tools.
grant select on table public.vendor_application_upload_sessions to authenticated, service_role;
grant insert, update, delete on table public.vendor_application_upload_sessions to service_role;

-- Tables with identity/bigserial columns need sequence access for allowed
-- inserts through API roles.
grant usage, select on sequence public.vendor_audit_logs_id_seq to authenticated, service_role;

-- Public application RPCs.
grant execute on function public.create_vendor_application_upload_session(text, text)
    to anon, authenticated, service_role;
grant execute on function public.is_valid_vendor_application_upload_session(uuid, text)
    to anon, authenticated, service_role;
grant execute on function public.submit_vendor_application(
    text, text, text, text, text, text, text, integer, text, text, text,
    text, text, text, text, text, text, boolean, boolean, text, text, text, uuid[]
) to anon, authenticated, service_role;

-- Authenticated helper/workflow RPCs.
grant execute on function public.has_sinbad_admin_role(text[]) to authenticated, service_role;
grant execute on function public.is_sinbad_admin() to authenticated, service_role;
grant execute on function public.is_sinbad_owner_or_admin() to authenticated, service_role;
grant execute on function public.is_sinbad_reviewer() to authenticated, service_role;
grant execute on function public.is_sinbad_finance() to authenticated, service_role;
grant execute on function public.is_vendor_member(uuid) to authenticated, service_role;
grant execute on function public.is_vendor_owner(uuid) to authenticated, service_role;
grant execute on function public.is_vendor_staff_or_owner(uuid) to authenticated, service_role;
grant execute on function public.current_user_vendor_ids() to authenticated, service_role;

grant execute on function public.create_product_submission(uuid, text, text, jsonb, numeric, text, integer, uuid[])
    to authenticated, service_role;
grant execute on function public.submit_product_submission(uuid) to authenticated, service_role;
grant execute on function public.approve_product_submission(uuid) to authenticated, service_role;
grant execute on function public.reject_product_submission(uuid, text) to authenticated, service_role;

grant execute on function public.create_vendor_live_session(uuid, text, timestamptz)
    to authenticated, service_role;
grant execute on function public.pin_vendor_live_product(uuid, uuid, integer)
    to authenticated, service_role;
grant execute on function public.unpin_vendor_live_product(uuid, uuid)
    to authenticated, service_role;

grant execute on function public.approve_commission(uuid, text) to authenticated, service_role;
grant execute on function public.mark_commission_paid(uuid, text) to authenticated, service_role;
grant execute on function public.void_commission(uuid, text) to authenticated, service_role;

grant execute on function public.mark_vendor_application_under_review(uuid) to authenticated, service_role;
grant execute on function public.request_vendor_application_changes(uuid, text) to authenticated, service_role;
grant execute on function public.approve_vendor_application(uuid, text) to authenticated, service_role;
grant execute on function public.reject_vendor_application(uuid, text) to authenticated, service_role;
grant execute on function public.application_has_required_documents(public.vendor_applications)
    to authenticated, service_role;

grant execute on function public.dry_run_publish_vendor_product(uuid, text)
    to authenticated, service_role;

grant execute on function public.update_vendor_product_price(uuid, numeric, numeric)
    to authenticated, service_role;
grant execute on function public.clear_vendor_product_sale_price(uuid)
    to authenticated, service_role;
grant execute on function public.update_vendor_product_inventory(uuid, integer)
    to authenticated, service_role;
grant execute on function public.mark_vendor_product_out_of_stock(uuid)
    to authenticated, service_role;
grant execute on function public.mark_vendor_product_available(uuid)
    to authenticated, service_role;
grant execute on function public.pause_vendor_product(uuid, text)
    to authenticated, service_role;

-- Keep audit writer protected for trusted server-side code only.
grant execute on function public.write_vendor_audit_log(uuid, text, text, uuid, jsonb)
    to service_role;
