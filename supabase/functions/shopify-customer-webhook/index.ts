// Sinbad Core — Integration Seam: Shopify customer webhook receiver
//
// Passive observer. On Shopify `customers/create` / `customers/update`, it
// verifies the Shopify HMAC, then calls the existing observe_shopify_customer()
// RPC to mint/reuse a neutral Sinbad ID. It never writes back to Shopify and
// never touches checkout, login, Flutter, or Firebase.
//
// Retry hygiene: genuine-but-unactionable deliveries return 2xx so Shopify
// does not retry needlessly. Only transient server/DB errors return 5xx so
// Shopify's retry can recover.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHOPIFY_WEBHOOK_SECRET = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Constant-time string comparison (avoids timing side-channels).
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Verify Shopify's X-Shopify-Hmac-Sha256 over the RAW request body.
async function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  return safeEqual(toBase64(signature), hmacHeader);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SHOPIFY_WEBHOOK_SECRET) {
    // Misconfiguration is transient from Shopify's view -> 500 lets it retry
    // once the secret/env is fixed. Never reveal which var is missing.
    return json({ error: "server_misconfigured" }, 500);
  }

  // Read the RAW body exactly as sent; required for a correct HMAC.
  const rawBody = await req.text();

  const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256");
  if (!hmacHeader) {
    return json({ error: "unauthorized" }, 401);
  }

  let valid = false;
  try {
    valid = await verifyShopifyHmac(rawBody, hmacHeader, SHOPIFY_WEBHOOK_SECRET);
  } catch {
    valid = false;
  }
  if (!valid) {
    // Not a genuine Shopify delivery -> reject; retries are irrelevant.
    return json({ error: "unauthorized" }, 401);
  }

  // From here the delivery is authenticated as genuinely from Shopify.
  // For anything we cannot act on, acknowledge with 2xx (retry won't help).
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ status: "ignored", reason: "unparseable_body" }, 200);
  }

  const rawId = payload?.id;
  const shopifyCustomerId =
    typeof rawId === "number" ? String(rawId)
    : typeof rawId === "string" && rawId.trim() !== "" ? rawId
    : null;

  if (!shopifyCustomerId) {
    return json({ status: "ignored", reason: "no_customer_id" }, 200);
  }

  const email = typeof payload?.email === "string" ? payload.email : null;
  const phone = typeof payload?.phone === "string" ? payload.phone : null;
  // Shopify customer payloads do not carry an ar/en preference; default to en.
  // AR/EN remains a permanent capability of core_identity (set elsewhere later).
  const language = "en";

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.rpc("observe_shopify_customer", {
    p_shopify_customer_id: shopifyCustomerId,
    p_email: email,
    p_phone: phone,
    p_language: language,
  });

  if (error) {
    // Transient/server error -> 500 so Shopify retries and we don't lose the event.
    return json({ error: "processing_failed" }, 500);
  }

  // Success (minted | reused | disabled) -> acknowledge.
  return json({ status: "ok", result: data }, 200);
});
