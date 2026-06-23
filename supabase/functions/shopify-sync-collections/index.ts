import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
const SHOPIFY_ADMIN_API_VERSION = Deno.env.get("SHOPIFY_ADMIN_API_VERSION");
const SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY = Deno.env.get("SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

type ShopifyConnection = {
  access_token_ciphertext: string;
  access_token_iv: string;
  scopes: string[];
  status: string;
};

type ShopifyCollectionNode = {
  id?: string;
  title?: string;
  handle?: string;
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

async function fetchCollections(accessToken: string) {
  const collections: Array<{ category_id: string; name: string; parent_name: null; handle: string | null }> = [];
  let cursor: string | null = null;

  for (let page = 0; page < 25; page += 1) {
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
            query SinbadCollectionSync($cursor: String) {
              collections(first: 100, after: $cursor, sortKey: TITLE) {
                nodes {
                  id
                  title
                  handle
                }
                pageInfo {
                  hasNextPage
                  endCursor
                }
              }
            }
          `,
          variables: { cursor },
        }),
      },
    );

    const body = await response.json().catch(() => null);
    if (!response.ok || body?.errors || !Array.isArray(body?.data?.collections?.nodes)) {
      throw new Error("shopify_collections_query_failed");
    }

    for (const node of body.data.collections.nodes as ShopifyCollectionNode[]) {
      if (typeof node.id === "string" && typeof node.title === "string" && node.title.trim()) {
        collections.push({
          category_id: node.id,
          name: node.title.trim(),
          parent_name: null,
          handle: typeof node.handle === "string" ? node.handle : null,
        });
      }
    }

    if (!body.data.collections.pageInfo?.hasNextPage) break;
    cursor = body.data.collections.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }

  return collections;
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

  if (!connectionData || connectionData.status !== "active") {
    return fail(409, "shopify_connection_required");
  }

  const connection = connectionData as ShopifyConnection;
  if (!connection.scopes.includes("read_products")) {
    return fail(403, "read_products_scope_required");
  }

  let collections: Awaited<ReturnType<typeof fetchCollections>>;
  try {
    const accessToken = await decryptToken(connection);
    collections = await fetchCollections(accessToken);
  } catch (error) {
    return fail(502, "shopify_collection_sync_failed", error instanceof Error ? error.message : null);
  }

  const syncTime = new Date().toISOString();
  const categoryIds = collections.map((collection) => collection.category_id);

  if (collections.length > 0) {
    const { error: upsertError } = await supabase
      .from("shopify_collection_categories")
      .upsert(
        collections.map((collection) => ({
          ...collection,
          status: "active",
          source: "shopify_collection",
          synced_at: syncTime,
        })),
        { onConflict: "category_id" },
      );

    if (upsertError) {
      return fail(500, "category_upsert_failed", upsertError.message);
    }
  }

  if (categoryIds.length > 0) {
    const { error: archiveError } = await supabase
      .from("shopify_collection_categories")
      .update({ status: "archived", synced_at: syncTime })
      .eq("source", "shopify_collection")
      .not("category_id", "in", `(${categoryIds.map((id) => `"${id}"`).join(",")})`);

    if (archiveError) {
      return fail(500, "category_archive_failed", archiveError.message);
    }
  }

  return json({
    ok: true,
    synced_count: collections.length,
    synced_at: syncTime,
  }, 200);
});
