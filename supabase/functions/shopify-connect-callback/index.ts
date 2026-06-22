import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
const SHOPIFY_CLIENT_ID = Deno.env.get("SHOPIFY_CLIENT_ID");
const SHOPIFY_CLIENT_SECRET = Deno.env.get("SHOPIFY_CLIENT_SECRET");
const SHOPIFY_ADMIN_API_VERSION = Deno.env.get("SHOPIFY_ADMIN_API_VERSION");
const SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY = Deno.env.get("SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY");

type ShopifyTokenResponse = {
  access_token?: string;
  scope?: string;
};

type ShopifyIdentity = {
  shop: {
    id: string | null;
    name: string | null;
    myshopifyDomain: string;
  };
  appInstallation: {
    id: string;
    app: {
      id: string | null;
      title: string | null;
      handle: string | null;
    };
  };
  scopes: string[];
};

function html(title: string, message: string, status: number) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="font-family:system-ui;padding:32px;line-height:1.5"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function hmacMessage(url: URL) {
  const entries: string[] = [];
  url.searchParams.forEach((value, key) => {
    if (key !== "hmac" && key !== "signature") {
      entries.push(`${key}=${value}`);
    }
  });
  return entries.sort().join("&");
}

async function verifyShopifyHmac(url: URL) {
  const hmac = url.searchParams.get("hmac");
  if (!hmac || !SHOPIFY_CLIENT_SECRET) return false;
  const expected = await hmacSha256Hex(SHOPIFY_CLIENT_SECRET, hmacMessage(url));
  return safeEqual(expected, hmac);
}

async function encryptionKey() {
  if (!SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY) {
    throw new Error("shopify_oauth_encryption_key_missing");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptToken(token: string) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await encryptionKey();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(token),
  );

  return {
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    iv: toBase64Url(iv),
  };
}

function scopeList(scope: string | undefined) {
  return (scope ?? "")
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function exchangeCode(shop: string, code: string): Promise<ShopifyTokenResponse> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: SHOPIFY_CLIENT_ID ?? "",
      client_secret: SHOPIFY_CLIENT_SECRET ?? "",
      code,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.access_token !== "string") {
    throw new Error("shopify_code_exchange_failed");
  }

  return body as ShopifyTokenResponse;
}

async function verifyIdentity(shop: string, accessToken: string): Promise<ShopifyIdentity> {
  const response = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `
          query VerifyShopifyOAuthConnection {
            shop {
              id
              name
              myshopifyDomain
            }
            currentAppInstallation {
              id
              app {
                id
                title
                handle
              }
              accessScopes {
                handle
              }
            }
          }
        `,
      }),
    },
  );

  const body = await response.json().catch(() => null);
  const shopData = body?.data?.shop;
  const appInstallation = body?.data?.currentAppInstallation;
  const accessScopes = appInstallation?.accessScopes;

  if (
    !response.ok ||
    body?.errors ||
    typeof shopData?.myshopifyDomain !== "string" ||
    typeof appInstallation?.id !== "string" ||
    !Array.isArray(accessScopes)
  ) {
    throw new Error("shopify_connection_preflight_failed");
  }

  return {
    shop: {
      id: typeof shopData.id === "string" ? shopData.id : null,
      name: typeof shopData.name === "string" ? shopData.name : null,
      myshopifyDomain: shopData.myshopifyDomain,
    },
    appInstallation: {
      id: appInstallation.id,
      app: {
        id: typeof appInstallation.app?.id === "string" ? appInstallation.app.id : null,
        title: typeof appInstallation.app?.title === "string" ? appInstallation.app.title : null,
        handle: typeof appInstallation.app?.handle === "string" ? appInstallation.app.handle : null,
      },
    },
    scopes: accessScopes
      .map((scope: { handle?: unknown }) => scope.handle)
      .filter((handle: unknown): handle is string => typeof handle === "string"),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return html("Method Not Allowed", "Only Shopify OAuth callback GET requests are accepted.", 405);
  }

  if (
    !SUPABASE_URL ||
    !SERVICE_ROLE_KEY ||
    !SHOPIFY_STORE_DOMAIN ||
    !SHOPIFY_CLIENT_ID ||
    !SHOPIFY_CLIENT_SECRET ||
    !SHOPIFY_ADMIN_API_VERSION ||
    !SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY
  ) {
    return html("Shopify Connection Failed", "Server OAuth configuration is incomplete.", 500);
  }

  const url = new URL(req.url);
  const shop = url.searchParams.get("shop")?.trim().toLowerCase() ?? "";
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";

  if (shop !== SHOPIFY_STORE_DOMAIN) {
    return html("Shopify Connection Failed", "Shop domain is not allowed.", 403);
  }

  if (!code || !state) {
    return html("Shopify Connection Failed", "Missing OAuth code or state.", 400);
  }

  if (!(await verifyShopifyHmac(url))) {
    return html("Shopify Connection Failed", "Invalid Shopify HMAC.", 401);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const stateHash = await sha256(state);
  const { data: stateRow, error: stateError } = await supabase
    .from("shopify_oauth_states")
    .select("state_hash,shop_domain,redirect_uri,status,created_by,expires_at")
    .eq("state_hash", stateHash)
    .eq("shop_domain", shop)
    .maybeSingle();

  if (stateError) {
    return html("Shopify Connection Failed", "OAuth state lookup failed.", 500);
  }

  if (!stateRow || stateRow.status !== "pending" || new Date(stateRow.expires_at).getTime() < Date.now()) {
    return html("Shopify Connection Failed", "OAuth state is invalid or expired.", 409);
  }

  let tokenResponse: ShopifyTokenResponse;
  let identity: ShopifyIdentity;
  let encryptedToken: { ciphertext: string; iv: string };

  try {
    tokenResponse = await exchangeCode(shop, code);
    if (!tokenResponse.access_token) {
      throw new Error("shopify_access_token_missing");
    }
    identity = await verifyIdentity(shop, tokenResponse.access_token);
    encryptedToken = await encryptToken(tokenResponse.access_token);
  } catch {
    await supabase
      .from("shopify_oauth_states")
      .update({ status: "used", used_at: new Date().toISOString() })
      .eq("state_hash", stateHash);
    return html("Shopify Connection Failed", "Shopify authorization could not be completed.", 502);
  }

  const tokenScopes = new Set([...scopeList(tokenResponse.scope), ...identity.scopes]);
  const requiredScopesPresent = tokenScopes.has("read_products") && tokenScopes.has("write_products");
  const now = new Date().toISOString();

  const { error: upsertError } = await supabase.from("shopify_connections").upsert(
    {
      shop_domain: shop,
      app_client_id: SHOPIFY_CLIENT_ID,
      access_token_ciphertext: encryptedToken.ciphertext,
      access_token_iv: encryptedToken.iv,
      scopes: Array.from(tokenScopes),
      status: requiredScopesPresent ? "active" : "error",
      shop_name: identity.shop.name,
      shopify_shop_id: identity.shop.id,
      app_installation_id: identity.appInstallation.id,
      app_id: identity.appInstallation.app.id,
      app_title: identity.appInstallation.app.title,
      connected_by: stateRow.created_by,
      connected_at: now,
      last_preflight_at: now,
      last_preflight_status: requiredScopesPresent ? "pass" : "missing_required_scopes",
      last_preflight_error: requiredScopesPresent ? null : "read_products_or_write_products_missing",
      updated_at: now,
    },
    { onConflict: "shop_domain" },
  );

  await supabase
    .from("shopify_oauth_states")
    .update({ status: "used", used_at: now })
    .eq("state_hash", stateHash);

  if (upsertError) {
    return html("Shopify Connection Failed", "Shopify connection could not be saved.", 500);
  }

  if (!requiredScopesPresent) {
    return html("Shopify Connected With Missing Scopes", "The app connected, but read_products/write_products were not both granted.", 409);
  }

  return html("Shopify Connected", "Shopify OAuth connection completed. You can return to Sinbad Admin.", 200);
});
