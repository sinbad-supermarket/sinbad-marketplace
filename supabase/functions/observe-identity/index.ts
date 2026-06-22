// Sinbad Core v0.1 — Passive Identity Minter
// Thin TypeScript entry point. Validates input and delegates to the
// observe_shopify_customer() Postgres function via the service role.
// No business logic lives here (it stays atomic in the database).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SINBAD_CORE_SECRET = Deno.env.get("SINBAD_CORE_SECRET");

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Constant-time comparison to avoid leaking the secret via timing.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SINBAD_CORE_SECRET) {
    // Never reveal which variable is missing.
    return json({ error: "server_misconfigured" }, 500);
  }

  // v0.1 endpoint protection: shared secret header (no JWT, no admin auth).
  const providedSecret = req.headers.get("X-Sinbad-Core-Secret");
  if (!providedSecret || !safeEqual(providedSecret, SINBAD_CORE_SECRET)) {
    // Do not log the secret. Do not expose it in the error.
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const shopifyCustomerId = body?.shopify_customer_id;
  if (typeof shopifyCustomerId !== "string" || shopifyCustomerId.trim() === "") {
    return json({ error: "shopify_customer_id_required" }, 400);
  }

  const email = typeof body?.email === "string" ? body.email : null;
  const phone = typeof body?.phone === "string" ? body.phone : null;
  const language = body?.language === "ar" || body?.language === "en"
    ? body.language
    : "en";

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
    return json({ error: error.message }, 500);
  }

  return json(data, 200);
});
