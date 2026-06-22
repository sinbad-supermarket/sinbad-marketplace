import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
const SHOPIFY_CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID");
const SHOPIFY_OAUTH_REDIRECT_URI = Deno.env.get("SHOPIFY_OAUTH_REDIRECT_URI");

const REQUIRED_SCOPES = "read_products,write_products";
const STATE_TTL_MS = 10 * 60 * 1000;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function fail(status: number, error: string, details?: unknown): Response {
  return json({ ok: false, error, details }, status);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return fail(405, "method_not_allowed");
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return fail(500, "server_misconfigured");
  }

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_CLIENT_ID || !SHOPIFY_OAUTH_REDIRECT_URI) {
    return fail(500, "shopify_oauth_configuration_missing");
  }

  const token = bearerToken(req);
  if (!token) {
    return fail(401, "authentication_required");
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return fail(401, "authentication_required");
  }

  const { data: adminUser, error: adminError } = await supabase
    .from("admin_users")
    .select("id, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (adminError) {
    return fail(500, "admin_lookup_failed");
  }

  if (!adminUser || !["owner", "admin"].includes(adminUser.role)) {
    return fail(403, "owner_or_admin_required");
  }

  const state = randomState();
  const stateHash = await sha256(state);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  const { error: stateError } = await supabase.from("shopify_oauth_states").insert({
    state_hash: stateHash,
    shop_domain: SHOPIFY_STORE_DOMAIN,
    redirect_uri: SHOPIFY_OAUTH_REDIRECT_URI,
    created_by: user.id,
    expires_at: expiresAt,
  });

  if (stateError) {
    return fail(500, "shopify_oauth_state_create_failed");
  }

  const authorizeUrl = new URL(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set("client_id", SHOPIFY_CLIENT_ID);
  authorizeUrl.searchParams.set("scope", REQUIRED_SCOPES);
  authorizeUrl.searchParams.set("redirect_uri", SHOPIFY_OAUTH_REDIRECT_URI);
  authorizeUrl.searchParams.set("state", state);

  return json({
    ok: true,
    authorizationUrl: authorizeUrl.toString(),
    shopDomain: SHOPIFY_STORE_DOMAIN,
    scopes: REQUIRED_SCOPES.split(","),
    expiresAt,
  }, 200);
});
