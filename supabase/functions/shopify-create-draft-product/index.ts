import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN");
const SHOPIFY_ADMIN_API_VERSION = Deno.env.get("SHOPIFY_ADMIN_API_VERSION");
const SHOPIFY_PRODUCT_PUBLISH_ENABLED = Deno.env.get("SHOPIFY_PRODUCT_PUBLISH_ENABLED");
const SHOPIFY_PUBLISH_MODE = Deno.env.get("SHOPIFY_PUBLISH_MODE");
const SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY = Deno.env.get("SHOPIFY_OAUTH_TOKEN_ENCRYPTION_KEY");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

type VendorProduct = {
  id: string;
  vendor_id: string;
  submission_id: string;
  status: string;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  shopify_inventory_item_id: string | null;
  publish_status: string;
  publish_attempt_count: number;
  publish_idempotency_key: string | null;
};

type ProductSubmission = {
  id: string;
  title: string;
  description: string | null;
  images: unknown;
  price: number | string | null;
  sku: string | null;
  inventory_quantity: number | null;
  status: string;
};

type Vendor = {
  id: string;
  name: string;
  slug: string;
};

type SubmissionImage = {
  storage_path: string;
  alt_text: string | null;
};

type RequestBody = {
  vendor_product_id?: string;
  preflight?: boolean;
};

type ShopifyConnection = {
  access_token_ciphertext: string;
  access_token_iv: string;
  scopes: string[];
  status: string;
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

function imageMedia(images: unknown, title: string) {
  if (!Array.isArray(images)) return [];

  return images
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((originalSource) => ({
      originalSource,
      alt: title,
      mediaContentType: "IMAGE",
    }));
}

async function submissionImageUrls(
  supabase: ReturnType<typeof createClient>,
  vendorProduct: VendorProduct,
  submission: ProductSubmission,
) {
  const { data: imageRows, error: imageError } = await supabase
    .from("vendor_product_submission_images")
    .select("storage_path,alt_text")
    .eq("submission_id", submission.id)
    .eq("vendor_id", vendorProduct.vendor_id)
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  if (imageError) {
    throw new Error("product_image_lookup_failed");
  }

  const uploadedImages = (imageRows ?? []) as SubmissionImage[];
  if (uploadedImages.length === 0) {
    return Array.isArray(submission.images)
      ? submission.images.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];
  }

  const { data: signedUrls, error: signedUrlError } = await supabase.storage
    .from("vendor-product-images")
    .createSignedUrls(
      uploadedImages.map((image) => image.storage_path),
      60 * 60 * 24,
    );

  if (signedUrlError) {
    throw new Error("product_image_signed_url_failed");
  }

  return (signedUrls ?? [])
    .map((signedUrl) => signedUrl.signedUrl)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function buildProductInput(
  vendorProduct: VendorProduct,
  submission: ProductSubmission,
  vendor: Vendor,
) {
  return {
    title: submission.title,
    descriptionHtml: submission.description ?? "",
    status: "DRAFT",
    vendor: vendor.name,
    tags: ["sinbad-core", "vendor-product", `vendor:${vendor.slug}`, "draft-only"],
    metafields: [
      {
        namespace: "sinbad",
        key: "vendor_id",
        type: "single_line_text_field",
        value: vendor.id,
      },
      {
        namespace: "sinbad",
        key: "vendor_product_id",
        type: "single_line_text_field",
        value: vendorProduct.id,
      },
      {
        namespace: "sinbad",
        key: "submission_id",
        type: "single_line_text_field",
        value: submission.id,
      },
      {
        namespace: "sinbad",
        key: "publish_environment",
        type: "single_line_text_field",
        value: SHOPIFY_PUBLISH_MODE ?? "draft_only",
      },
      {
        namespace: "sinbad",
        key: "source",
        type: "single_line_text_field",
        value: "sinbad-core",
      },
    ],
  };
}

function productSku(vendorProduct: VendorProduct, submission: ProductSubmission) {
  return submission.sku?.trim() || `SINBAD-${vendorProduct.id.slice(0, 8).toUpperCase()}`;
}

function buildVariantUpdateInput(
  variantId: string,
  vendorProduct: VendorProduct,
  submission: ProductSubmission,
) {
  return {
    id: variantId,
    price: String(submission.price),
    inventoryItem: {
      sku: productSku(vendorProduct, submission),
    },
  };
}

async function callShopifyGraphql(payload: Record<string, unknown>, accessToken: string) {
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
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    const body = await response.json().catch(() => null);
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadShopifyAccessToken(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from("shopify_connections")
    .select("access_token_ciphertext,access_token_iv,scopes,status")
    .eq("shop_domain", SHOPIFY_STORE_DOMAIN)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error("shopify_connection_lookup_failed");
  }
  if (!data) {
    throw new Error("shopify_oauth_connection_required");
  }

  return decryptToken(data as ShopifyConnection);
}

async function verifyShopifyOAuthConnection(accessToken: string) {
  const query = `
    query VerifyShopifyOAuthConnection {
      shop {
        id
        name
        myshopifyDomain
      }
      currentAppInstallation {
        accessScopes {
          handle
        }
      }
    }
  `;

  const { response, body } = await callShopifyGraphql({ query }, accessToken);
  const shop = body?.data?.shop;
  const accessScopes = body?.data?.currentAppInstallation?.accessScopes;
  const errors = Array.isArray(body?.errors) ? body.errors : [];

  if (
    !response.ok ||
    errors.length > 0 ||
    typeof shop?.name !== "string" ||
    typeof shop?.myshopifyDomain !== "string" ||
    !Array.isArray(accessScopes)
  ) {
    return {
      ok: false,
      status: response.status,
      hasShop: typeof shop?.name === "string" && typeof shop?.myshopifyDomain === "string",
      hasAccessScopes: Array.isArray(accessScopes),
      errors: errors.map((error: { message?: unknown; extensions?: { code?: unknown } }) => ({
        message: typeof error.message === "string" ? error.message : "unknown_graphql_error",
        code: typeof error.extensions?.code === "string" ? error.extensions.code : null,
      })),
    };
  }

  const scopeHandles = accessScopes
    .map((scope: { handle?: unknown }) => scope.handle)
    .filter((handle: unknown): handle is string => typeof handle === "string");

  return {
    ok: true,
    status: response.status,
    storeDomain: SHOPIFY_STORE_DOMAIN,
    shop: {
      name: shop.name as string,
      myshopifyDomain: shop.myshopifyDomain as string,
    },
    read_products: scopeHandles.includes("read_products"),
    write_products: scopeHandles.includes("write_products"),
    tokenSource: "stored_oauth_authorization_code_token",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (req.method !== "POST") {
    return fail(405, "method_not_allowed");
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return fail(500, "server_misconfigured");
  }

  if (SHOPIFY_PRODUCT_PUBLISH_ENABLED !== "true" || SHOPIFY_PUBLISH_MODE !== "draft_only") {
    return fail(412, "shopify_draft_publishing_disabled");
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

  if (!adminUser || !["owner", "admin", "reviewer"].includes(adminUser.role)) {
    return fail(403, "admin_or_reviewer_required");
  }

  let requestBody: RequestBody;
  try {
    requestBody = await req.json();
  } catch {
    return fail(400, "invalid_json");
  }

  if (requestBody.preflight === true) {
    if (!["owner", "admin"].includes(adminUser.role)) {
      return fail(403, "owner_or_admin_required");
    }

    try {
      const accessToken = await loadShopifyAccessToken(supabase);
      const preflightResult = await verifyShopifyOAuthConnection(accessToken);
      return json(preflightResult, preflightResult.ok ? 200 : 502);
    } catch (error) {
      return fail(
        502,
        error instanceof Error ? error.message : "shopify_oauth_preflight_failed",
      );
    }
  }

  const vendorProductId = requestBody.vendor_product_id;
  if (!vendorProductId) {
    return fail(400, "vendor_product_id_required");
  }

  if (!["owner", "admin"].includes(adminUser.role)) {
    return fail(403, "owner_or_admin_required");
  }

  const { data: productData, error: productError } = await supabase
    .from("vendor_products")
    .select("*")
    .eq("id", vendorProductId)
    .maybeSingle();

  if (productError) {
    return fail(500, "vendor_product_lookup_failed");
  }
  if (!productData) {
    return fail(404, "vendor_product_not_found");
  }

  const vendorProduct = productData as VendorProduct;
  const safePublishStatuses = ["not_published", "dry_run_ready", "failed"];

  if (vendorProduct.status !== "approved") {
    return fail(409, "vendor_product_must_be_approved");
  }
  if (!safePublishStatuses.includes(vendorProduct.publish_status)) {
    return fail(409, "vendor_product_publish_status_not_allowed");
  }
  if (vendorProduct.shopify_product_id) {
    return json({
      ok: true,
      already_created: true,
      vendor_product_id: vendorProduct.id,
      shopify_product_id: vendorProduct.shopify_product_id,
      shopify_variant_id: vendorProduct.shopify_variant_id,
      shopify_inventory_item_id: vendorProduct.shopify_inventory_item_id,
      message: "Shopify product already exists. No Shopify call was made.",
    }, 200);
  }

  const { data: submissionData, error: submissionError } = await supabase
    .from("vendor_product_submissions")
    .select("*")
    .eq("id", vendorProduct.submission_id)
    .eq("vendor_id", vendorProduct.vendor_id)
    .maybeSingle();

  if (submissionError) {
    return fail(500, "product_submission_lookup_failed");
  }
  if (!submissionData) {
    return fail(404, "product_submission_not_found");
  }

  const submission = submissionData as ProductSubmission;
  if (submission.status !== "approved") {
    return fail(409, "product_submission_must_be_approved");
  }
  if (!submission.title?.trim()) {
    return fail(422, "product_title_required");
  }
  if (submission.price === null || Number(submission.price) <= 0) {
    return fail(422, "valid_product_price_required");
  }

  const { data: vendorData, error: vendorError } = await supabase
    .from("vendors")
    .select("id, name, slug")
    .eq("id", vendorProduct.vendor_id)
    .maybeSingle();

  if (vendorError) {
    return fail(500, "vendor_lookup_failed");
  }
  if (!vendorData) {
    return fail(404, "vendor_not_found");
  }

  const vendor = vendorData as Vendor;
  const productIdempotencyKey =
    vendorProduct.publish_idempotency_key ?? `shopify-draft-create:${vendorProduct.id}:v1`;

  const { data: previousAttempt } = await supabase
    .from("vendor_product_publish_attempts")
    .select("id, status, response_payload")
    .eq("vendor_product_id", vendorProduct.id)
    .eq("mode", "draft_create")
    .eq("status", "succeeded")
    .maybeSingle();

  if (previousAttempt) {
    return json({
      ok: true,
      already_created: true,
      vendor_product_id: vendorProduct.id,
      attempt_id: previousAttempt.id,
      response: previousAttempt.response_payload,
      message: "A successful draft creation attempt already exists. No Shopify call was made.",
    }, 200);
  }

  let accessToken: string;
  try {
    accessToken = await loadShopifyAccessToken(supabase);
  } catch (error) {
    return fail(
      412,
      "shopify_oauth_connection_required",
      error instanceof Error ? error.message : "shopify_oauth_connection_required",
    );
  }

  let mediaUrls: string[];
  try {
    mediaUrls = await submissionImageUrls(supabase, vendorProduct, submission);
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : "product_image_lookup_failed");
  }

  if (mediaUrls.length === 0) {
    return fail(422, "product_image_required");
  }

  const productInput = buildProductInput(vendorProduct, submission, vendor);
  const media = imageMedia(mediaUrls, submission.title);
  const productCreateMutation = `
    mutation CreateDraftVendorProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product {
          id
          title
          status
          variants(first: 1) {
            nodes {
              id
              sku
              price
              inventoryItem {
                id
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const productCreatePayload = {
    query: productCreateMutation,
    variables: {
      product: productInput,
      media,
    },
  };
  const attemptIdempotencyKey = `${productIdempotencyKey}:attempt:${crypto.randomUUID()}`;
  const initialRequestPayload = {
    product_idempotency_key: productIdempotencyKey,
    product_create: productCreatePayload,
  };

  const { data: attempt, error: attemptError } = await supabase
    .from("vendor_product_publish_attempts")
    .insert({
      vendor_product_id: vendorProduct.id,
      vendor_id: vendorProduct.vendor_id,
      mode: "draft_create",
      status: "started",
      idempotency_key: attemptIdempotencyKey,
      request_payload: initialRequestPayload,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (attemptError) {
    return fail(409, "publish_attempt_already_exists_or_failed", attemptError.message);
  }

  await supabase
    .from("vendor_products")
    .update({
      publish_status: "publishing",
      publish_attempt_count: vendorProduct.publish_attempt_count + 1,
      publish_idempotency_key: productIdempotencyKey,
      last_publish_payload: initialRequestPayload,
      last_publish_attempt_at: new Date().toISOString(),
      published_by: user.id,
      shopify_publish_error: null,
    })
    .eq("id", vendorProduct.id);

  let shopifyResult: Awaited<ReturnType<typeof callShopifyGraphql>>;
  try {
    shopifyResult = await callShopifyGraphql(productCreatePayload, accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_shopify_error";
    await supabase
      .from("vendor_product_publish_attempts")
      .update({
        status: "needs_review",
        error: message,
        response_payload: { error: message },
      })
      .eq("id", attempt.id);
    await supabase
      .from("vendor_products")
      .update({
        publish_status: "failed_needs_review",
        shopify_publish_error: message,
        last_publish_attempt_at: new Date().toISOString(),
      })
      .eq("id", vendorProduct.id);

    await supabase.rpc("write_vendor_audit_log", {
      p_vendor_id: vendorProduct.vendor_id,
      p_action: "shopify_product_draft_create_needs_review",
      p_entity_type: "vendor_product",
      p_entity_id: vendorProduct.id,
      p_metadata: {
        attempt_id: attempt.id,
        idempotency_key: productIdempotencyKey,
        attempt_idempotency_key: attemptIdempotencyKey,
        error: message,
      },
    });

    return fail(502, "shopify_response_unknown_needs_review", message);
  }

  const responsePayload = shopifyResult.body;
  const productCreate = responsePayload?.data?.productCreate;
  const userErrors = productCreate?.userErrors ?? [];
  const createdProduct = productCreate?.product;

  if (!shopifyResult.response.ok || responsePayload?.errors || userErrors.length > 0 || !createdProduct?.id) {
    const errorText = JSON.stringify(responsePayload?.errors ?? userErrors ?? responsePayload);
    await supabase
      .from("vendor_product_publish_attempts")
      .update({
        status: "failed",
        error: errorText,
        response_payload: responsePayload ?? {},
      })
      .eq("id", attempt.id);
    await supabase
      .from("vendor_products")
      .update({
        publish_status: "failed",
        shopify_publish_error: errorText,
        last_publish_attempt_at: new Date().toISOString(),
      })
      .eq("id", vendorProduct.id);

    await supabase.rpc("write_vendor_audit_log", {
      p_vendor_id: vendorProduct.vendor_id,
      p_action: "shopify_product_draft_create_failed",
      p_entity_type: "vendor_product",
      p_entity_id: vendorProduct.id,
      p_metadata: {
        attempt_id: attempt.id,
        idempotency_key: productIdempotencyKey,
        attempt_idempotency_key: attemptIdempotencyKey,
        response: responsePayload,
      },
    });

    return fail(502, "shopify_product_create_failed", responsePayload);
  }

  const variant = createdProduct.variants?.nodes?.[0] ?? null;
  if (!variant?.id) {
    const errorText = "shopify_default_variant_missing";
    const now = new Date().toISOString();
    await supabase
      .from("vendor_product_publish_attempts")
      .update({
        status: "needs_review",
        error: errorText,
        response_payload: { product_create: responsePayload, error: errorText },
      })
      .eq("id", attempt.id);
    await supabase
      .from("vendor_products")
      .update({
        shopify_product_id: createdProduct.id,
        shopify_created_status: createdProduct.status,
        shopify_created_at: now,
        shopify_last_verified_at: now,
        publish_status: "failed_needs_review",
        shopify_publish_error: errorText,
        last_publish_attempt_at: now,
      })
      .eq("id", vendorProduct.id);

    await supabase.rpc("write_vendor_audit_log", {
      p_vendor_id: vendorProduct.vendor_id,
      p_action: "shopify_product_draft_create_needs_review",
      p_entity_type: "vendor_product",
      p_entity_id: vendorProduct.id,
      p_metadata: {
        attempt_id: attempt.id,
        idempotency_key: productIdempotencyKey,
        attempt_idempotency_key: attemptIdempotencyKey,
        shopify_product_id: createdProduct.id,
        error: errorText,
      },
    });

    return fail(502, "shopify_default_variant_missing_needs_review", responsePayload);
  }

  const variantUpdateMutation = `
    mutation UpdateDraftVendorProductVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        product {
          id
        }
        productVariants {
          id
          sku
          price
          inventoryItem {
            id
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variantUpdatePayload = {
    query: variantUpdateMutation,
    variables: {
      productId: createdProduct.id,
      variants: [
        buildVariantUpdateInput(variant.id, vendorProduct, submission),
      ],
    },
  };
  const fullRequestPayload = {
    product_idempotency_key: productIdempotencyKey,
    product_create: productCreatePayload,
    variant_update: variantUpdatePayload,
  };

  await supabase
    .from("vendor_product_publish_attempts")
    .update({
      request_payload: fullRequestPayload,
    })
    .eq("id", attempt.id);
  await supabase
    .from("vendor_products")
    .update({
      last_publish_payload: fullRequestPayload,
    })
    .eq("id", vendorProduct.id);

  let variantUpdateResult: Awaited<ReturnType<typeof callShopifyGraphql>>;
  try {
    variantUpdateResult = await callShopifyGraphql(variantUpdatePayload, accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_shopify_error";
    const now = new Date().toISOString();
    await supabase
      .from("vendor_product_publish_attempts")
      .update({
        status: "needs_review",
        error: message,
        response_payload: { product_create: responsePayload, variant_update: { error: message } },
      })
      .eq("id", attempt.id);
    await supabase
      .from("vendor_products")
      .update({
        shopify_product_id: createdProduct.id,
        shopify_variant_id: variant.id,
        shopify_created_status: createdProduct.status,
        shopify_created_at: now,
        shopify_last_verified_at: now,
        publish_status: "failed_needs_review",
        shopify_publish_error: message,
        last_publish_attempt_at: now,
      })
      .eq("id", vendorProduct.id);

    await supabase.rpc("write_vendor_audit_log", {
      p_vendor_id: vendorProduct.vendor_id,
      p_action: "shopify_product_draft_create_needs_review",
      p_entity_type: "vendor_product",
      p_entity_id: vendorProduct.id,
      p_metadata: {
        attempt_id: attempt.id,
        idempotency_key: productIdempotencyKey,
        attempt_idempotency_key: attemptIdempotencyKey,
        shopify_product_id: createdProduct.id,
        shopify_variant_id: variant.id,
        error: message,
      },
    });

    return fail(502, "shopify_variant_update_unknown_needs_review", message);
  }

  const variantUpdateResponsePayload = variantUpdateResult.body;
  const variantUpdate = variantUpdateResponsePayload?.data?.productVariantsBulkUpdate;
  const variantUpdateUserErrors = variantUpdate?.userErrors ?? [];
  const updatedVariant = variantUpdate?.productVariants?.[0] ?? null;
  if (
    !variantUpdateResult.response.ok ||
    variantUpdateResponsePayload?.errors ||
    variantUpdateUserErrors.length > 0 ||
    !updatedVariant?.id
  ) {
    const errorText = JSON.stringify(
      variantUpdateResponsePayload?.errors ?? variantUpdateUserErrors ?? variantUpdateResponsePayload,
    );
    const now = new Date().toISOString();
    await supabase
      .from("vendor_product_publish_attempts")
      .update({
        status: "needs_review",
        error: errorText,
        response_payload: {
          product_create: responsePayload,
          variant_update: variantUpdateResponsePayload ?? {},
        },
      })
      .eq("id", attempt.id);
    await supabase
      .from("vendor_products")
      .update({
        shopify_product_id: createdProduct.id,
        shopify_variant_id: variant.id,
        shopify_created_status: createdProduct.status,
        shopify_created_at: now,
        shopify_last_verified_at: now,
        publish_status: "failed_needs_review",
        shopify_publish_error: errorText,
        last_publish_attempt_at: now,
      })
      .eq("id", vendorProduct.id);

    await supabase.rpc("write_vendor_audit_log", {
      p_vendor_id: vendorProduct.vendor_id,
      p_action: "shopify_product_draft_create_needs_review",
      p_entity_type: "vendor_product",
      p_entity_id: vendorProduct.id,
      p_metadata: {
        attempt_id: attempt.id,
        idempotency_key: productIdempotencyKey,
        attempt_idempotency_key: attemptIdempotencyKey,
        shopify_product_id: createdProduct.id,
        shopify_variant_id: variant.id,
        response: variantUpdateResponsePayload,
      },
    });

    return fail(502, "shopify_variant_update_failed_needs_review", variantUpdateResponsePayload);
  }

  const finalVariant = updatedVariant;
  const inventoryItemId = variant?.inventoryItem?.id ?? null;
  const now = new Date().toISOString();

  await supabase
    .from("vendor_product_publish_attempts")
    .update({
      status: "succeeded",
      response_payload: {
        product_create: responsePayload,
        variant_update: variantUpdateResponsePayload,
      },
    })
    .eq("id", attempt.id);

  await supabase
    .from("vendor_products")
    .update({
      shopify_product_id: createdProduct.id,
      shopify_variant_id: finalVariant.id,
      shopify_inventory_item_id: finalVariant.inventoryItem?.id ?? inventoryItemId,
      shopify_created_status: createdProduct.status,
      shopify_created_at: now,
      shopify_published_at: null,
      shopify_last_verified_at: now,
      publish_status: "shopify_draft_created",
      shopify_publish_error: null,
      last_publish_payload: fullRequestPayload,
      last_publish_attempt_at: now,
      published_by: user.id,
    })
    .eq("id", vendorProduct.id);

  await supabase.rpc("write_vendor_audit_log", {
    p_vendor_id: vendorProduct.vendor_id,
    p_action: "shopify_product_draft_created",
    p_entity_type: "vendor_product",
    p_entity_id: vendorProduct.id,
    p_metadata: {
      attempt_id: attempt.id,
      idempotency_key: productIdempotencyKey,
      attempt_idempotency_key: attemptIdempotencyKey,
      shopify_product_id: createdProduct.id,
      shopify_variant_id: finalVariant.id,
      shopify_inventory_item_id: finalVariant.inventoryItem?.id ?? inventoryItemId,
      shopify_created_status: createdProduct.status,
      customer_visible: false,
    },
  });

  return json({
    ok: true,
    mode: "draft_create",
    vendor_product_id: vendorProduct.id,
    shopify_product_id: createdProduct.id,
    shopify_variant_id: finalVariant.id,
    shopify_inventory_item_id: finalVariant.inventoryItem?.id ?? inventoryItemId,
    shopify_created_status: createdProduct.status,
    message: "Shopify draft created — not published to customers.",
  }, 200);
});
