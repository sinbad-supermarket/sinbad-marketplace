-- Sinbad Core v0.1 — Passive Identity Minter
-- Migration 0002: observe_shopify_customer() + kill-switch seed
--
-- Behavior:
--   1. If the kill-switch is off -> safe no-op (returns action = 'disabled').
--   2. Exact match on shopify_customer_id -> reuse existing Sinbad ID.
--   3. No match -> mint a new neutral Sinbad ID.
--   4. Race-safe via the UNIQUE constraint + ON CONFLICT DO NOTHING.
--   5. Matches on shopify_customer_id ONLY. Never email, never phone,
--      never guests, never merges.

-- Seed the kill-switch (enabled by default).
insert into public.core_settings (key, value)
values ('identity_minter_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function public.observe_shopify_customer(
    p_shopify_customer_id text,
    p_email               text default null,
    p_phone               text default null,
    p_language            text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_enabled boolean;
    v_lang    text;
    v_id      public.core_identity;
    v_action  text;
begin
    -- Require the anchor; never proceed without it (no guest handling).
    if p_shopify_customer_id is null or length(trim(p_shopify_customer_id)) = 0 then
        raise exception 'shopify_customer_id is required';
    end if;

    -- Kill-switch: safe disable.
    select (value)::boolean into v_enabled
    from public.core_settings
    where key = 'identity_minter_enabled';

    if v_enabled is distinct from true then
        return jsonb_build_object('action', 'disabled');
    end if;

    -- Normalize language to the supported set; default 'en'.
    v_lang := case when p_language in ('ar', 'en') then p_language else 'en' end;

    -- Mint attempt. ON CONFLICT DO NOTHING makes this race-safe:
    -- exactly one Sinbad ID per Shopify customer, even under concurrency.
    insert into public.core_identity (
        shopify_customer_id, email_signal, phone_signal, language_preference
    )
    values (
        p_shopify_customer_id, p_email, p_phone, v_lang
    )
    on conflict (shopify_customer_id) do nothing
    returning * into v_id;

    if v_id.sinbad_id is not null then
        v_action := 'minted';
    else
        -- Already existed -> reuse (exact match on the anchor only).
        select * into v_id
        from public.core_identity
        where shopify_customer_id = p_shopify_customer_id;
        v_action := 'reused';
    end if;

    -- Append-only audit (presence flags only; raw signals stay in core_identity).
    insert into public.core_identity_audit (
        sinbad_id, shopify_customer_id, action, detail
    )
    values (
        v_id.sinbad_id,
        p_shopify_customer_id,
        v_action,
        jsonb_build_object(
            'email_present', p_email is not null,
            'phone_present', p_phone is not null
        )
    );

    return jsonb_build_object(
        'action',              v_action,
        'sinbad_id',           v_id.sinbad_id,
        'shopify_customer_id', v_id.shopify_customer_id,
        'language_preference', v_id.language_preference
    );
end;
$$;

-- Only the backend service role may execute this. No public/anon/authenticated.
revoke all on function public.observe_shopify_customer(text, text, text, text) from public;
revoke all on function public.observe_shopify_customer(text, text, text, text) from anon;
revoke all on function public.observe_shopify_customer(text, text, text, text) from authenticated;
grant execute on function public.observe_shopify_customer(text, text, text, text) to service_role;
