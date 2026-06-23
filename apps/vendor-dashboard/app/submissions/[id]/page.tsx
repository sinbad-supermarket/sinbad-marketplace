"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { supabase } from "@/lib/supabase";

type SubmissionStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "changes_requested"
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
  barcode: string | null;
  inventory_quantity: number | null;
  shopify_category_id: string | null;
  suggested_category: string | null;
  status: SubmissionStatus;
  review_status: SubmissionStatus | null;
  review_notes: string | null;
  review_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  shopify_collection_categories: {
    name: string;
    parent_name: string | null;
  } | null;
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

const statusLabels: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  archived: "Archived"
};

const statusClasses: Record<SubmissionStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  submitted: "bg-sky-50 text-sky-700 ring-sky-200",
  under_review: "bg-amber-50 text-amber-800 ring-amber-200",
  changes_requested: "bg-orange-50 text-orange-800 ring-orange-200",
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

function SubmissionDetail({ submissionId, vendor }: { submissionId: string; vendor: VendorContext }) {
  const [submission, setSubmission] = useState<ProductSubmission | null>(null);
  const [uploadedImagePreviews, setUploadedImagePreviews] = useState<UploadedImagePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadSubmission = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("vendor_product_submissions")
      .select("*,shopify_collection_categories(name,parent_name)")
      .eq("id", submissionId)
      .eq("vendor_id", vendor.vendorId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      setSubmission(null);
      setUploadedImagePreviews([]);
    } else {
      const nextSubmission = data as ProductSubmission | null;
      setSubmission(nextSubmission);

      if (nextSubmission) {
        const { data: imageRows, error: imageError } = await supabase
          .from("vendor_product_submission_images")
          .select("id,storage_bucket,storage_path,original_filename")
          .eq("submission_id", nextSubmission.id)
          .eq("vendor_id", vendor.vendorId)
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
      } else {
        setUploadedImagePreviews([]);
      }
    }

    setLoading(false);
  }, [submissionId, vendor.vendorId]);

  useEffect(() => {
    void loadSubmission();
  }, [loadSubmission]);

  async function handleSubmitForReview() {
    if (!submission) return;

    setActionLoading(true);
    setError(null);
    setActionMessage(null);

    const { error: rpcError } = await supabase.rpc("submit_product_submission", {
      p_submission_id: submission.id
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setActionMessage("Submission sent for review.");
      await loadSubmission();
    }

    setActionLoading(false);
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading submission...</div>
      </section>
    );
  }

  if (error && !submission) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load submission</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/submissions"
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
        <h1 className="text-xl font-semibold text-ink">Submission not found</h1>
        <Link
          href="/submissions"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Product Submissions
        </Link>
      </section>
    );
  }

  const canSubmit =
    submission.status === "draft" ||
    submission.status === "rejected" ||
    submission.status === "changes_requested";
  const canEdit = canSubmit;
  const imageUrls =
    uploadedImagePreviews.length > 0
      ? uploadedImagePreviews.map((image) => image.url).filter(Boolean)
      : parseImageUrls(submission.images);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/submissions"
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

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Link
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              href={`/submissions/${submission.id}/edit`}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit Submission
            </Link>
            <button
              className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={actionLoading}
              onClick={handleSubmitForReview}
            >
              {actionLoading ? "Submitting..." : "Submit for Review"}
            </button>
          </div>
        ) : null}
      </div>

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

      {submission.status === "changes_requested" && submission.review_notes ? (
        <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-900">
          Changes requested: {submission.review_notes}
        </div>
      ) : null}

      {submission.status === "rejected" && submission.review_reason ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
          Rejection reason: {submission.review_reason}
        </div>
      ) : null}

      <Section title="Product">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Title" value={submission.title} />
          <DetailField label="Price" value={formatMoney(submission.price)} />
          <DetailField label="SKU" value={submission.sku} />
          <DetailField label="Barcode (EAN / UPC)" value={submission.barcode} />
          <DetailField label="Inventory" value={submission.inventory_quantity} />
          <DetailField
            label="Category"
            value={
              submission.shopify_collection_categories
                ? [
                    submission.shopify_collection_categories.parent_name,
                    submission.shopify_collection_categories.name
                  ]
                    .filter(Boolean)
                    .join(" / ")
                : null
            }
          />
          <DetailField label="Suggested category" value={submission.suggested_category} />
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

      <Section title="Review">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Status" value={statusLabels[submission.status]} />
          <DetailField
            label="Review status"
            value={submission.review_status ? statusLabels[submission.review_status] : null}
          />
          <DetailField label="Review notes" value={submission.review_notes} />
          <DetailField label="Requested changes" value={submission.review_notes} />
          <DetailField label="Rejection reason" value={submission.review_reason} />
          <DetailField label="Reviewed date" value={formatDate(submission.reviewed_at)} />
          <DetailField label="Updated date" value={formatDate(submission.updated_at)} />
        </dl>
      </Section>
    </div>
  );
}

export default function SubmissionDetailPage({ params }: DetailPageProps) {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <SubmissionDetail submissionId={params.id} vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
