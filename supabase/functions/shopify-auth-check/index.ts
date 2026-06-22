import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
const SHOPIFY_ADMIN_API_VERSION = Deno.env.get("SHOPIFY_ADMIN_API_VERSION");
const SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY = Deno.env.get("SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

type ShopifyConnection = {
  shop_domain: string;
  app_client_id: string;
  access_token_ciphertext: string;
  access_token_iv: string;
  scopes: string[];
  status: string;
  shop_name: string | null;
  shopify_shop_id: string | null;
  app_installation_id: string | null;
  app_id: string | null;
  app_title: string | null;
  connected_at: string;
  last_preflight_at: string | null;
  last_preflight_status: string | null;
  last_preflight_error: string | null;
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function fail(status: number, error: string): Response {
  return json({ success: false, error }, status);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function encryptionKey() {
  if (!SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY) {
    throw new Error("shopify_oauth_encryption_key_missing");
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
}

async function decryptToken(connection: ShopifyConnection) {
  const key = await encryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(connection.access_token_iv) },
    key,
    fromBase64Url(connection.access_token_ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function verifyShopifyIdentity(accessToken: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: `
            query VerifyShopifyOAuthIdentity {
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
              products(first: 1) {
                nodes {
                  id
                  title
                }
              }
            }
          `,
        }),
        signal: controller.signal,
      },
    );

    const body = await response.json().catch(() => null);
    const shop = body?.data?.shop;
    const appInstallation = body?.data?.currentAppInstallation;
    const accessScopes = appInstallation?.accessScopes;
    const products = body?.data?.products?.nodes;

    if (
      !response.ok ||
      body?.errors ||
      typeof shop?.myshopifyDomain !== "string" ||
      typeof appInstallation?.id !== "string" ||
      !Array.isArray(accessScopes) ||
      !Array.isArray(products)
    ) {
      throw new Error("shopify_scope_query_failed");
    }

    return {
      shop: {
        id: typeof shop.id === "string" ? shop.id : null,
        name: typeof shop.name === "string" ? shop.name : null,
        myshopifyDomain: shop.myshopifyDomain as string,
      },
      currentAppInstallation: {
        id: appInstallation.id as string,
        app: {
          id: typeof appInstallation.app?.id === "string" ? appInstallation.app.id : null,
          title: typeof appInstallation.app?.title === "string" ? appInstallation.app.title : null,
          handle: typeof appInstallation.app?.handle === "string" ? appInstallation.app.handle : null,
        },
      },
      scopes: accessScopes
        .map((scope: { handle?: unknown }) => scope.handle)
        .filter((handle: unknown): handle is string => typeof handle === "string"),
      productReadCapability: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return fail(405, "method_not_allowed");
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return fail(500, "server_misconfigured");
  }

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_API_VERSION || !SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY) {
    return fail(500, "shopify_configuration_missing");
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

  const { data: connectionData, error: connectionError } = await supabase
    .from("shopify_connections")
    .select("*")
    .eq("shop_domain", SHOPIFY_STORE_DOMAIN)
    .maybeSingle();

  if (connectionError) {
    return fail(500, "shopify_connection_lookup_failed");
  }

  if (!connectionData) {
    return json({
      success: true,
      connected: false,
      storeDomain: SHOPIFY_STORE_DOMAIN,
      read_products: false,
      write_products: false,
      needsAuthorization: true,
    }, 200);
  }

  const connection = connectionData as ShopifyConnection;
  if (connection.status !== "active") {
    return json({
      success: true,
      connected: false,
      storeDomain: SHOPIFY_STORE_DOMAIN,
      connectionStatus: connection.status,
      read_products: connection.scopes.includes("read_products"),
      write_products: connection.scopes.includes("write_products"),
      needsAuthorization: true,
    }, 200);
  }

  let identity: Awaited<ReturnType<typeof verifyShopifyIdentity>>;
  try {
    const accessToken = await decryptToken(connection);
    identity = await verifyShopifyIdentity(accessToken);
  } catch {
    return fail(502, "shopify_oauth_preflight_failed");
  }

  const scopeSet = new Set(identity.scopes);
  const readProducts = scopeSet.has("read_products");
  const writeProducts = scopeSet.has("write_products");

  return json({
    success: true,
    connected: true,
    read_products: readProducts,
    write_products: writeProducts,
    storeDomain: SHOPIFY_STORE_DOMAIN,
    needsAuthorization: !readProducts || !writeProducts,
    shop: identity.shop,
    currentAppInstallation: identity.currentAppInstallation,
    productReadCapability: identity.productReadCapability,
    tokenSource: "stored_oauth_authorization_code_token",
    connection: {
      shopDomain: connection.shop_domain,
      appClientId: connection.app_client_id,
      connectedAt: connection.connected_at,
      lastPreflightAt: connection.last_preflight_at,
      lastPreflightStatus: connection.last_preflight_status,
      lastPreflightError: connection.last_preflight_error,
    },
  }, 200);
});
