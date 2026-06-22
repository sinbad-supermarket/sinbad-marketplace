"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { supabase } from "@/lib/supabase";

type ProductStatus = "approved" | "publishing" | "published" | "unpublished" | "archived";

type PublishStatus =
  | "not_published"
  | "dry_run_ready"
  | "publishing"
  | "shopify_draft_created"
  | "published"
  | "failed"
  | "failed_needs_review"
  | "rolled_back";

type OperationalStatus = "available" | "out_of_stock" | "paused";

type VendorProduct = {
  id: string;
  vendor_id: string;
  submission_id: string;
  title: string;
  status: ProductStatus;
  publish_status: PublishStatus | null;
  base_price: number | null;
  sale_price: number | null;
  inventory_quantity: number | null;
  operational_status: OperationalStatus;
  operational_updated_at: string | null;
  operational_updated_by: string | null;
  last_shopify_sync_status: string | null;
  last_shopify_sync_error: string | null;
  last_shopify_sync_at: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  shopify_inventory_item_id: string | null;
  shopify_created_status: string | null;
  shopify_created_at: string | null;
  shopify_published_at: string | null;
  shopify_last_verified_at: string | null;
  shopify_publish_error: string | null;
  publish_attempt_count: number | null;
  publish_idempotency_key: string | null;
  last_publish_attempt_at: string | null;
  rollback_reason: string | null;
  rollback_at: string | null;
  created_at: string;
  updated_at: string;
};

type ProductSubmission = {
  id: string;
  title: string;
  description: string | null;
  images: unknown;
  price: number | null;
  sku: string | null;
  inventory_quantity: number | null;
  status: string;
  reviewed_at: string | null;
};

type DetailPageProps = {
  params: {
    id: string;
  };
};

const statusLabels: Record<ProductStatus, string> = {
  approved: "Approved",
  publishing: "Publishing",
  published: "Published",
  unpublished: "Unpublished",
  archived: "Archived"
};

const statusClasses: Record<ProductStatus, string> = {
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  publishing: "bg-amber-50 text-amber-800 ring-amber-200",
  published: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  unpublished: "bg-slate-100 text-slate-700 ring-slate-200",
  archived: "bg-zinc-100 text-zinc-700 ring-zinc-200"
};

const publishStatusLabels: Record<PublishStatus, string> = {
  not_published: "Not published",
  dry_run_ready: "Dry run ready",
  publishing: "Publishing",
  shopify_draft_created: "Shopify draft created",
  published: "Published",
  failed: "Failed",
  failed_needs_review: "Failed, needs review",
  rolled_back: "Rolled back"
};

const publishStatusClasses: Record<PublishStatus, string> = {
  not_published: "bg-slate-100 text-slate-700 ring-slate-200",
  dry_run_ready: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  publishing: "bg-amber-50 text-amber-800 ring-amber-200",
  shopify_draft_created: "bg-violet-50 text-violet-700 ring-violet-200",
  published: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  failed_needs_review: "bg-rose-50 text-rose-700 ring-rose-200",
  rolled_back: "bg-zinc-100 text-zinc-700 ring-zinc-200"
};

const operationalStatusLabels: Record<OperationalStatus, string> = {
  available: "Available",
  out_of_stock: "Out of stock",
  paused: "Paused"
};

const operationalStatusClasses: Record<OperationalStatus, string> = {
  available: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  out_of_stock: "bg-amber-50 text-amber-800 ring-amber-200",
  paused: "bg-zinc-100 text-zinc-700 ring-zinc-200"
};

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatMoney(value: number | null) {
  if (value === null) return "Not set";
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(Number(value));
}

function fieldValue(value: string | number | null) {
  if (value === null || value === "") return "Not provided";
  return String(value);
}

function DetailField({
  label,
  value
}: {
  label: string;
  value: string | number | null;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-ink">{fieldValue(value)}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function parseImageUrls(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function ProductDetail({ productId, vendor }: { productId: string; vendor: VendorContext }) {
  const [product, setProduct] = useState<VendorProduct | null>(null);
  const [submission, setSubmission] = useState<ProductSubmission | null>(null);
  const [priceForm, setPriceForm] = useState({ basePrice: "", salePrice: "" });
  const [inventoryValue, setInventoryValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("vendor_products")
      .select("*")
      .eq("id", productId)
      .eq("vendor_id", vendor.vendorId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      setProduct(null);
      setSubmission(null);
      setLoading(false);
      return;
    }

    const loadedProduct = data as VendorProduct | null;
    setProduct(loadedProduct);
    setPriceForm({
      basePrice: loadedProduct?.base_price?.toString() ?? "",
      salePrice: loadedProduct?.sale_price?.toString() ?? ""
    });
    setInventoryValue(loadedProduct?.inventory_quantity?.toString() ?? "");

    if (loadedProduct?.submission_id) {
      const { data: submissionData, error: submissionError } = await supabase
        .from("vendor_product_submissions")
        .select("id,title,description,images,price,sku,inventory_quantity,status,reviewed_at")
        .eq("id", loadedProduct.submission_id)
        .eq("vendor_id", vendor.vendorId)
        .maybeSingle();

      if (submissionError) {
        setError(submissionError.message);
        setSubmission(null);
      } else {
        setSubmission(submissionData as ProductSubmission | null);
      }
    } else {
      setSubmission(null);
    }

    setLoading(false);
  }, [productId, vendor.vendorId]);

  useEffect(() => {
    void loadProduct();
  }, [loadProduct]);

  async function runAction(label: string, action: () => Promise<{ error: { message: string } | null }>) {
    setActionLoading(label);
    setError(null);
    setMessage(null);

    const { error: actionError } = await action();

    if (actionError) {
      setError(actionError.message);
    } else {
      setMessage(`${label} completed. Internal only — Shopify sync is not enabled yet.`);
      await loadProduct();
    }

    setActionLoading(null);
  }

  function updatePrice() {
    const basePrice = Number(priceForm.basePrice);
    const salePrice = priceForm.salePrice.trim() === "" ? null : Number(priceForm.salePrice);

    void runAction("Update price", async () =>
      await supabase.rpc("update_vendor_product_price", {
        p_vendor_product_id: productId,
        p_base_price: basePrice,
        p_sale_price: salePrice
      })
    );
  }

  function clearSalePrice() {
    void runAction("Clear sale price", async () =>
      await supabase.rpc("clear_vendor_product_sale_price", {
        p_vendor_product_id: productId
      })
    );
  }

  function updateInventory() {
    void runAction("Update inventory", async () =>
      await supabase.rpc("update_vendor_product_inventory", {
        p_vendor_product_id: productId,
        p_inventory_quantity: Number(inventoryValue)
      })
    );
  }

  function markOutOfStock() {
    void runAction("Mark out of stock", async () =>
      await supabase.rpc("mark_vendor_product_out_of_stock", {
        p_vendor_product_id: productId
      })
    );
  }

  function markAvailable() {
    void runAction("Mark available", async () =>
      await supabase.rpc("mark_vendor_product_available", {
        p_vendor_product_id: productId
      })
    );
  }

  function pauseProduct() {
    const reason = window.prompt("Optional pause reason:");
    void runAction("Pause product", async () =>
      await supabase.rpc("pause_vendor_product", {
        p_vendor_product_id: productId,
        p_reason: reason?.trim() || null
      })
    );
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading product...</div>
      </section>
    );
  }

  if (error && !product) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load product</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/products"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Products
        </Link>
      </section>
    );
  }

  if (!product) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Product not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          This product is not available for the selected vendor.
        </p>
        <Link
          href="/products"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Products
        </Link>
      </section>
    );
  }

  const publishStatus = product.publish_status ?? "not_published";
  const imageUrls = parseImageUrls(submission?.images);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/products"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Products
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{product.title}</h1>
          <span
            className={[
              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              statusClasses[product.status]
            ].join(" ")}
          >
            {statusLabels[product.status]}
          </span>
          <span
            className={[
              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              operationalStatusClasses[product.operational_status]
            ].join(" ")}
          >
            {operationalStatusLabels[product.operational_status]}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Internal product controls only. Shopify sync is not enabled yet.
        </p>
      </div>

      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
        Internal only. These changes do not update Shopify, publish products, unpublish products, or
        modify the storefront catalog.
      </div>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <Section title="Operations">
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="rounded-md border border-line p-4">
            <h3 className="text-sm font-semibold text-ink">Pricing</h3>
            <label className="mt-3 block">
              <span className="text-xs font-semibold uppercase text-slate-500">Base price</span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
                inputMode="decimal"
                value={priceForm.basePrice}
                onChange={(event) =>
                  setPriceForm((current) => ({ ...current, basePrice: event.target.value }))
                }
              />
            </label>
            <label className="mt-3 block">
              <span className="text-xs font-semibold uppercase text-slate-500">Sale price</span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
                inputMode="decimal"
                value={priceForm.salePrice}
                onChange={(event) =>
                  setPriceForm((current) => ({ ...current, salePrice: event.target.value }))
                }
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={updatePrice}
              >
                Update Price
              </button>
              <button
                className="h-9 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={clearSalePrice}
              >
                Clear Sale
              </button>
            </div>
          </div>

          <div className="rounded-md border border-line p-4">
            <h3 className="text-sm font-semibold text-ink">Inventory</h3>
            <label className="mt-3 block">
              <span className="text-xs font-semibold uppercase text-slate-500">
                Inventory quantity
              </span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
                inputMode="numeric"
                value={inventoryValue}
                onChange={(event) => setInventoryValue(event.target.value)}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={updateInventory}
              >
                Update Inventory
              </button>
              <button
                className="h-9 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={markOutOfStock}
              >
                Mark Out of Stock
              </button>
            </div>
          </div>

          <div className="rounded-md border border-line p-4">
            <h3 className="text-sm font-semibold text-ink">Availability</h3>
            <dl className="mt-3 space-y-3">
              <DetailField
                label="Operational status"
                value={operationalStatusLabels[product.operational_status]}
              />
              <DetailField
                label="Last operation update"
                value={formatDate(product.operational_updated_at)}
              />
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={markAvailable}
              >
                Mark Available
              </button>
              <button
                className="h-9 rounded-md bg-amber-700 px-3 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={pauseProduct}
              >
                Pause Internally
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Product">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Product ID" value={product.id} />
          <DetailField label="Title" value={product.title} />
          <DetailField label="Product status" value={statusLabels[product.status]} />
          <DetailField label="Base price" value={formatMoney(product.base_price)} />
          <DetailField label="Sale price" value={formatMoney(product.sale_price)} />
          <DetailField label="Inventory" value={product.inventory_quantity} />
          <DetailField label="Submission ID" value={product.submission_id} />
          <DetailField label="Created date" value={formatDate(product.created_at)} />
          <DetailField label="Updated date" value={formatDate(product.updated_at)} />
        </dl>
      </Section>

      <Section title="Submission Details">
        {submission ? (
          <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DetailField label="Submission status" value={submission.status} />
            <DetailField label="Original submitted price" value={formatMoney(submission.price)} />
            <DetailField label="SKU" value={submission.sku} />
            <DetailField label="Original submitted inventory" value={submission.inventory_quantity} />
            <DetailField label="Reviewed date" value={formatDate(submission.reviewed_at)} />
            <DetailField label="Description" value={submission.description} />
          </dl>
        ) : (
          <p className="mt-4 text-sm text-slate-600">Linked submission details are not available.</p>
        )}
      </Section>

      <Section title="Images">
        {imageUrls.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No image URLs provided.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {imageUrls.map((url) => (
              <a
                key={url}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-slate-50"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="truncate">{url}</span>
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}
      </Section>

      <Section title="Publishing">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Publish status" value={publishStatusLabels[publishStatus]} />
          <DetailField label="Shopify product ID" value={product.shopify_product_id} />
          <DetailField label="Shopify variant ID" value={product.shopify_variant_id} />
          <DetailField
            label="Shopify inventory item ID"
            value={product.shopify_inventory_item_id}
          />
          <DetailField label="Shopify created status" value={product.shopify_created_status} />
          <DetailField label="Shopify created date" value={formatDate(product.shopify_created_at)} />
          <DetailField label="Published date" value={formatDate(product.shopify_published_at)} />
          <DetailField
            label="Last verified date"
            value={formatDate(product.shopify_last_verified_at)}
          />
          <DetailField
            label="Last publish attempt"
            value={formatDate(product.last_publish_attempt_at)}
          />
          <DetailField label="Publish attempts" value={product.publish_attempt_count ?? 0} />
          <DetailField label="Idempotency key" value={product.publish_idempotency_key} />
          <DetailField label="Publish error" value={product.shopify_publish_error} />
          <DetailField label="Last Shopify sync status" value={product.last_shopify_sync_status} />
          <DetailField label="Last Shopify sync date" value={formatDate(product.last_shopify_sync_at)} />
          <DetailField label="Last Shopify sync error" value={product.last_shopify_sync_error} />
        </dl>
      </Section>

      <Section title="Rollback">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Rollback reason" value={product.rollback_reason} />
          <DetailField label="Rollback date" value={formatDate(product.rollback_at)} />
        </dl>
      </Section>
    </div>
  );
}

export default function ProductDetailPage({ params }: DetailPageProps) {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <ProductDetail productId={params.id} vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
