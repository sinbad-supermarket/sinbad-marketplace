"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type SubmissionStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "published"
  | "archived";

type ProductSubmission = {
  id: string;
  vendor_id: string;
  title: string;
  description: string | null;
  images: unknown;
  price: number | null;
  sku: string | null;
  inventory_quantity: number | null;
  status: SubmissionStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
  vendors: {
    id: string;
    name: string;
    slug: string;
    status: string;
  } | null;
};

type VendorProduct = {
  id: string;
  status: "approved" | "publishing" | "published" | "unpublished" | "archived";
  base_price: number | null;
  sale_price: number | null;
  inventory_quantity: number | null;
  operational_status: "available" | "out_of_stock" | "paused";
  operational_updated_at: string | null;
  operational_updated_by: string | null;
  last_shopify_sync_status: string | null;
  last_shopify_sync_error: string | null;
  last_shopify_sync_at: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  publish_status:
    | "not_published"
    | "dry_run_ready"
    | "publishing"
    | "shopify_draft_created"
    | "published"
    | "failed"
    | "failed_needs_review"
    | "rolled_back";
  shopify_publish_error: string | null;
  shopify_published_at: string | null;
  shopify_inventory_item_id: string | null;
  shopify_created_status: string | null;
  shopify_created_at: string | null;
  shopify_last_verified_at: string | null;
  publish_attempt_count: number;
  publish_idempotency_key: string | null;
  last_publish_payload: unknown;
  last_publish_attempt_at: string | null;
};

type UploadedImagePreview = {
  id: string;
  url: string;
  label: string;
};

type DetailPageProps = {
  params: {
    id: string;
  };
};

type AdminRole = "owner" | "admin" | "reviewer" | "finance";

const statusLabels: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved internally - not yet published to Shopify",
  rejected: "Rejected",
  published: "Published",
  archived: "Archived"
};

const statusClasses: Record<SubmissionStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  submitted: "bg-sky-50 text-sky-700 ring-sky-200",
  under_review: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200",
  published: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  archived: "bg-zinc-100 text-zinc-700 ring-zinc-200"
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

function ProductSubmissionDetail({
  submissionId,
  adminRole
}: {
  submissionId: string;
  adminRole: AdminRole;
}) {
  const [submission, setSubmission] = useState<ProductSubmission | null>(null);
  const [vendorProduct, setVendorProduct] = useState<VendorProduct | null>(null);
  const [uploadedImagePreviews, setUploadedImagePreviews] = useState<UploadedImagePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadSubmission = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("vendor_product_submissions")
      .select("*,vendors(id,name,slug,status)")
      .eq("id", submissionId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      setSubmission(null);
      setVendorProduct(null);
      setUploadedImagePreviews([]);
    } else {
      const nextSubmission = data as unknown as ProductSubmission | null;
      setSubmission(nextSubmission);

      if (nextSubmission) {
        const { data: imageRows, error: imageError } = await supabase
          .from("vendor_product_submission_images")
          .select("id,storage_bucket,storage_path,original_filename")
          .eq("submission_id", nextSubmission.id)
          .eq("vendor_id", nextSubmission.vendor_id)
          .eq("status", "active")
          .order("sort_order", { ascending: true });

        if (imageError) {
          setError(imageError.message);
          setUploadedImagePreviews([]);
        } else if (imageRows && imageRows.length > 0) {
          const paths = imageRows.map((image) => image.storage_path as string);
          const { data: signedUrls, error: signedUrlError } = await supabase.storage
            .from("vendor-product-images")
            .createSignedUrls(paths, 3600);

          if (signedUrlError) {
            setError(signedUrlError.message);
            setUploadedImagePreviews([]);
          } else {
            setUploadedImagePreviews(
              imageRows.map((image, index) => ({
                id: image.id as string,
                url: signedUrls?.[index]?.signedUrl ?? "",
                label: (image.original_filename as string | null) ?? `Image ${index + 1}`
              }))
            );
          }
        } else {
          setUploadedImagePreviews([]);
        }

        const { data: productData, error: productError } = await supabase
          .from("vendor_products")
          .select(
            [
              "id",
              "status",
              "base_price",
              "sale_price",
              "inventory_quantity",
              "operational_status",
              "operational_updated_at",
              "operational_updated_by",
              "last_shopify_sync_status",
              "last_shopify_sync_error",
              "last_shopify_sync_at",
              "shopify_product_id",
              "shopify_variant_id",
              "shopify_inventory_item_id",
              "publish_status",
              "shopify_publish_error",
              "shopify_published_at",
              "shopify_created_status",
              "shopify_created_at",
              "shopify_last_verified_at",
              "publish_attempt_count",
              "publish_idempotency_key",
              "last_publish_payload",
              "last_publish_attempt_at"
            ].join(",")
          )
          .eq("submission_id", nextSubmission.id)
          .maybeSingle();

        if (productError) {
          setError(productError.message);
          setVendorProduct(null);
        } else {
          setVendorProduct(productData as unknown as VendorProduct | null);
        }
      } else {
        setVendorProduct(null);
        setUploadedImagePreviews([]);
      }
    }

    setLoading(false);
  }, [submissionId]);

  useEffect(() => {
    void loadSubmission();
  }, [loadSubmission]);

  async function runAction(
    label: string,
    rpcName: "approve_product_submission" | "reject_product_submission",
    args: Record<string, string>
  ) {
    setActionLoading(label);
    setError(null);
    setActionMessage(null);

    const { error: rpcError } = await supabase.rpc(rpcName, args);

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setActionMessage(`${label} completed.`);
      await loadSubmission();
    }

    setActionLoading(null);
  }

  function handleApprove() {
    const confirmed = window.confirm(
      "Approve this product submission internally? This will not publish it to Shopify."
    );
    if (!confirmed) return;

    void runAction("Approve", "approve_product_submission", {
      p_submission_id: submissionId
    });
  }

  function handleReject() {
    const notes = window.prompt("Enter rejection notes:");
    if (!notes || notes.trim().length === 0) return;

    const confirmed = window.confirm("Reject this product submission?");
    if (!confirmed) return;

    void runAction("Reject", "reject_product_submission", {
      p_submission_id: submissionId,
      p_review_notes: notes.trim()
    });
  }

  async function handleDryRunPublish() {
    if (!vendorProduct) return;

    const confirmed = window.confirm(
      "Run a Shopify publish dry run? This generates a payload preview only. No Shopify product will be created."
    );
    if (!confirmed) return;

    setActionLoading("Dry run publish");
    setError(null);
    setActionMessage(null);

    const { error: rpcError } = await supabase.rpc("dry_run_publish_vendor_product", {
      p_vendor_product_id: vendorProduct.id,
      p_publish_environment: "local"
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setActionMessage("Dry run completed. No Shopify product was created.");
      await loadSubmission();
    }

    setActionLoading(null);
  }

  async function handleCreateShopifyDraft() {
    if (!vendorProduct) return;

    const confirmed = window.confirm(
      "Create this product as a DRAFT in Shopify? This will not publish it to the Online Store or make it customer-visible."
    );
    if (!confirmed) return;

    setActionLoading("Create Shopify draft");
    setError(null);
    setActionMessage(null);

    const { data, error: functionError } = await supabase.functions.invoke(
      "shopify-create-draft-product",
      {
        body: {
          vendor_product_id: vendorProduct.id
        }
      }
    );

    if (functionError) {
      setError(functionError.message);
    } else {
      const message =
        typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
          ? data.message
          : "Shopify draft created — not published to customers.";
      setActionMessage(message);
      await loadSubmission();
    }

    setActionLoading(null);
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading product submission...</div>
      </section>
    );
  }

  if (error && !submission) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load product submission</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/product-submissions"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Product Submissions
        </Link>
      </section>
    );
  }

  if (!submission) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Product submission not found</h1>
        <Link
          href="/product-submissions"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Product Submissions
        </Link>
      </section>
    );
  }

  const canReview = submission.status === "submitted" || submission.status === "under_review";
  const canDryRunPublish =
    submission.status === "approved" &&
    vendorProduct?.status === "approved" &&
    vendorProduct.publish_status !== "published" &&
    vendorProduct.publish_status !== "shopify_draft_created" &&
    !vendorProduct.shopify_product_id;
  const canCreateShopifyDraft =
    ["owner", "admin"].includes(adminRole) &&
    submission.status === "approved" &&
    vendorProduct?.status === "approved" &&
    ["not_published", "dry_run_ready", "failed"].includes(vendorProduct.publish_status) &&
    !vendorProduct.shopify_product_id;
  const imageUrls =
    uploadedImagePreviews.length > 0
      ? uploadedImagePreviews.map((image) => image.url).filter(Boolean)
      : parseImageUrls(submission.images);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/product-submissions"
            className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Product Submissions
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">{submission.title}</h1>
            <span
              className={[
                "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                statusClasses[submission.status]
              ].join(" ")}
            >
              {statusLabels[submission.status]}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Created {formatDate(submission.created_at)}
          </p>
        </div>

        {canReview ? (
          <div className="flex flex-wrap gap-2">
            <button
              className="h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              disabled={Boolean(actionLoading)}
              onClick={handleApprove}
            >
              Approve
            </button>
            <button
              className="h-9 rounded-md bg-rose-700 px-3 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
              disabled={Boolean(actionLoading)}
              onClick={handleReject}
            >
              Reject
            </button>
          </div>
        ) : null}
        {!canReview && canDryRunPublish ? (
          <div className="flex flex-wrap gap-2">
            <button
              className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={Boolean(actionLoading)}
              onClick={handleDryRunPublish}
            >
              Dry Run Shopify Publish
            </button>
            {canCreateShopifyDraft ? (
              <button
                className="h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={handleCreateShopifyDraft}
              >
                Create Shopify Draft
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {actionLoading ? (
        <div className="rounded-md border border-line bg-white px-4 py-3 text-sm font-medium text-slate-600">
          {actionLoading} in progress...
        </div>
      ) : null}

      {actionMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {actionMessage}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      {submission.status === "approved" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Approved internally - not yet published to Shopify.
        </div>
      ) : null}

      {vendorProduct?.publish_status === "dry_run_ready" ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900">
          Dry run only — no Shopify product was created.
        </div>
      ) : null}

      {vendorProduct?.publish_status === "shopify_draft_created" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
          Shopify draft created — not published to customers.
        </div>
      ) : null}

      {vendorProduct?.publish_status === "failed_needs_review" ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
          Publishing status needs manual review. Check Shopify Admin before retrying to avoid
          duplicate products.
        </div>
      ) : null}

      <Section title="Product">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Title" value={submission.title} />
          <DetailField label="Price" value={formatMoney(submission.price)} />
          <DetailField label="SKU" value={submission.sku} />
          <DetailField label="Inventory" value={submission.inventory_quantity} />
          <DetailField label="Description" value={submission.description} />
        </dl>
      </Section>

      <Section title="Images">
        {imageUrls.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No product images provided.</p>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {imageUrls.map((url, index) => (
              <a
                key={url}
                className="overflow-hidden rounded-md border border-line bg-white text-sm font-semibold text-ink hover:bg-slate-50"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  alt={uploadedImagePreviews[index]?.label ?? `Product image ${index + 1}`}
                  className="h-40 w-full object-cover"
                  src={url}
                />
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="truncate">
                    {uploadedImagePreviews[index]?.label ?? url}
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                </div>
              </a>
            ))}
          </div>
        )}
      </Section>

      <Section title="Vendor">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Vendor name" value={submission.vendors?.name ?? null} />
          <DetailField label="Vendor slug" value={submission.vendors?.slug ?? null} />
          <DetailField label="Vendor status" value={submission.vendors?.status ?? null} />
          <DetailField label="Vendor ID" value={submission.vendor_id} />
        </dl>
      </Section>

      <Section title="Vendor Operations">
        {vendorProduct ? (
          <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DetailField label="Base price" value={formatMoney(vendorProduct.base_price)} />
            <DetailField label="Sale price" value={formatMoney(vendorProduct.sale_price)} />
            <DetailField label="Inventory quantity" value={vendorProduct.inventory_quantity} />
            <DetailField label="Operational status" value={vendorProduct.operational_status} />
            <DetailField
              label="Operational updated date"
              value={formatDate(vendorProduct.operational_updated_at)}
            />
            <DetailField
              label="Operational updated by"
              value={vendorProduct.operational_updated_by}
            />
            <DetailField
              label="Last Shopify sync status"
              value={vendorProduct.last_shopify_sync_status}
            />
            <DetailField
              label="Last Shopify sync date"
              value={formatDate(vendorProduct.last_shopify_sync_at)}
            />
            <DetailField
              label="Last Shopify sync error"
              value={vendorProduct.last_shopify_sync_error}
            />
          </dl>
        ) : (
          <p className="mt-4 text-sm text-slate-600">
            Operational fields appear after the submission is approved and a vendor product exists.
          </p>
        )}
      </Section>

      <Section title="Shopify Publishing">
        {vendorProduct ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              Draft only. Verify manually in Shopify Admin before any storefront publishing.
            </div>
            <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <DetailField label="Vendor product ID" value={vendorProduct.id} />
              <DetailField label="Product status" value={vendorProduct.status} />
              <DetailField label="Publish status" value={vendorProduct.publish_status} />
              <DetailField label="Publish attempts" value={vendorProduct.publish_attempt_count} />
              <DetailField label="Idempotency key" value={vendorProduct.publish_idempotency_key} />
              <DetailField
                label="Last dry-run attempt"
                value={formatDate(vendorProduct.last_publish_attempt_at)}
              />
              <DetailField label="Shopify product ID" value={vendorProduct.shopify_product_id} />
              <DetailField label="Shopify variant ID" value={vendorProduct.shopify_variant_id} />
              <DetailField
                label="Shopify inventory item ID"
                value={vendorProduct.shopify_inventory_item_id}
              />
              <DetailField label="Shopify status" value={vendorProduct.shopify_created_status} />
              <DetailField
                label="Shopify created date"
                value={formatDate(vendorProduct.shopify_created_at)}
              />
              <DetailField
                label="Shopify last verified"
                value={formatDate(vendorProduct.shopify_last_verified_at)}
              />
              <DetailField label="Publish error" value={vendorProduct.shopify_publish_error} />
            </dl>
            {vendorProduct.last_publish_payload ? (
              <div>
                <div className="text-xs font-semibold uppercase text-slate-500">
                  Payload preview
                </div>
                <pre className="mt-2 max-h-[420px] overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                  {JSON.stringify(vendorProduct.last_publish_payload, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                No dry-run payload has been generated for this product.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600">
            No internal vendor product exists yet. Approve the submission before running a Shopify
            publish dry run.
          </p>
        )}
      </Section>

      <Section title="Review">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Status" value={statusLabels[submission.status]} />
          <DetailField label="Review notes" value={submission.review_notes} />
          <DetailField label="Reviewed by" value={submission.reviewed_by} />
          <DetailField label="Reviewed date" value={formatDate(submission.reviewed_at)} />
          <DetailField label="Submitted by" value={submission.submitted_by} />
          <DetailField label="Updated date" value={formatDate(submission.updated_at)} />
        </dl>
      </Section>
    </div>
  );
}

export default function ProductSubmissionDetailPage({ params }: DetailPageProps) {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <ProductSubmissionDetail submissionId={params.id} adminRole={admin.role} />
        </AdminShell>
      )}
    </AuthGate>
  );
}
