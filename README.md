# Sinbad Core — v0.1 (Passive Identity Minter)

The first deployable unit of Sinbad Core. It does exactly one thing:

> When a Shopify logged-in customer is observed, create or reuse a neutral
> internal **Sinbad ID** and link it to the Shopify customer ID.

Nothing else is built. This unit is passive, additive, and safe to disable.

## Stack

- **Backend:** TypeScript (Supabase Edge Function)
- **Database:** PostgreSQL (managed by Supabase)
- **Admin:** Supabase Studio only
- **Deploy target:** `api.sinbadsupermarket.com`

## What it guarantees

| Rule | How |
|------|-----|
| Sinbad ID is neutral, internal, permanent, never reused | Generated `uuid` primary key; never deleted or recycled |
| Shopify customer ID is the only automatic matching anchor | `UNIQUE` column; matched on exclusively |
| Email/phone are weak signals only | Stored in nullable columns, never matched on |
| No email/phone auto-link, no guest merge | No such logic exists |
| Avoid wrong merges (duplicates acceptable) | Exact-match-only + `ON CONFLICT DO NOTHING` |
| Safe to disable | `core_settings.identity_minter_enabled` kill-switch |
| Arabic & English ready day one | `language_preference` (`ar`/`en`) |
| Existing systems unchanged | Only a passively-called backend + DB |
| Endpoint protected | Shared secret header `X-Sinbad-Core-Secret` vs `SINBAD_CORE_SECRET` |

## Structure

```
.
├── package.json                 # Supabase CLI scripts
├── .env.example                 # required environment variables
├── .gitignore
└── supabase/
    ├── config.toml
    ├── migrations/
    │   ├── 20260618000100_core_identity_v0_1.sql   # tables + RLS (no policies)
    │   └── 20260618000200_observe_identity_fn.sql  # observe_shopify_customer() + kill-switch
    └── functions/
        ├── observe-identity/
        │   └── index.ts                  # thin HTTP entry -> RPC (shared-secret header)
        └── shopify-customer-webhook/
            └── index.ts                  # Shopify webhook receiver (HMAC) -> RPC
```

## Data model

- **`core_identity`** — `sinbad_id` (uuid PK), `shopify_customer_id` (unique),
  `email_signal`, `phone_signal`, `language_preference` (`ar`/`en`), `status`,
  timestamps.
- **`core_identity_audit`** — append-only `minted`/`reused` records.
- **`core_settings`** — key/value config; holds the `identity_minter_enabled`
  kill-switch.

Row-Level Security is enabled with **no policies**, so the tables are reachable
only by the backend service role via `observe_shopify_customer()`.

## How the minter behaves

`observe_shopify_customer(p_shopify_customer_id, p_email, p_phone, p_language)`:

1. Kill-switch off → returns `{ "action": "disabled" }` (no-op).
2. Exact match on `shopify_customer_id` → **reuse** existing Sinbad ID.
3. No match → **mint** a new neutral Sinbad ID.
4. Always writes an audit row. Matches on `shopify_customer_id` only.

## Local development

Requires the Supabase CLI.

```bash
npm run start          # start local Supabase
npm run db:reset       # apply migrations
npm run functions:serve
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SINBAD_CORE_SECRET`, and
`SHOPIFY_WEBHOOK_SECRET` (see `.env.example`).

## Endpoint protection (v0.1)

The `observe-identity` endpoint is protected by a **shared secret header**
(no JWT, no admin auth in v0.1):

- Every caller must send header `X-Sinbad-Core-Secret`.
- It is compared (constant-time) against the `SINBAD_CORE_SECRET` env var.
- Missing or invalid → `401 unauthorized`.
- The secret is never logged and never included in any error response.
- If the server is missing required env vars, it returns `500 server_misconfigured`
  without revealing which variable is missing.

Example request:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/observe-identity" \
  -H "content-type: application/json" \
  -H "X-Sinbad-Core-Secret: $SINBAD_CORE_SECRET" \
  -d '{"shopify_customer_id":"123","language":"ar"}'
```

`verify_jwt` remains `false` for v0.1; the shared secret is the chosen
protection mechanism. Rotate the secret by updating `SINBAD_CORE_SECRET`.

## Integration Seam — Shopify customer webhook

`shopify-customer-webhook` is the first real producer of identity signals. It
passively observes Shopify customer events and mints/reuses Sinbad IDs.

- Subscribed topics: `customers/create`, `customers/update`.
- Authenticity: verifies `X-Shopify-Hmac-Sha256` (constant-time) against
  `SHOPIFY_WEBHOOK_SECRET`. Invalid/missing signature → `401`.
- On valid events it calls the existing `observe_shopify_customer()` RPC with
  the Shopify customer `id` (anchor) plus `email`/`phone` as weak signals;
  `language` defaults to `en`.
- It never writes back to Shopify and never touches checkout, login, Flutter,
  or Firebase. The `identity_minter_enabled` kill-switch still applies.
- Retry hygiene: authenticated-but-unactionable deliveries (unparseable body,
  no customer id, minter disabled) return `2xx` so Shopify does not retry
  needlessly; only transient server/DB errors return `5xx` so Shopify retries.

> Note (forward consideration, not handled yet): Shopify webhooks send the
> numeric REST customer id, while the Customer Account API (Flutter, later) may
> surface a GID-format id. An id-normalization decision is required **before**
> connecting Flutter to avoid duplicate Sinbad IDs. This receiver alone is
> internally consistent (single source).

## Kill-switch

Disable the minter at any time (via Supabase Studio or SQL):

```sql
update public.core_settings
set value = 'false'::jsonb
where key = 'identity_minter_enabled';
```

## Out of scope (v0.1)

Wallet, coins, rewards, games, missions, family accounts, referrals, customer
levels, multi-vendor, admin panel, Flutter UI, Shopify checkout changes,
Firebase migration, email/phone auto-linking, guest handling, merges.
