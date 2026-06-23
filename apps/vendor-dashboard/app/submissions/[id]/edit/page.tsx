"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { CategoryPicker } from "@/components/category-picker";
import type { ProductCategory } from "@/components/category-picker";
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
  price: number | null;
  sku: string | null;
  barcode: string | null;
  inventory_quantity: number | null;
  shopify_category_id: string | null;
  suggested_category: string | null;
  status: SubmissionStatus;
  review_notes: string | null;
  review_reason: string | null;
  created_at: string;
  updated_at: string;
};

type ExistingImage = {
  id: string;
  url: string;
  label: string;
};

type FormState = {
  title: string;
  description: string;
  price: string;
  sku: string;
  barcode: string;
  inventoryQuantity: string;
  shopifyCategoryId: string;
  categorySearch: string;
  suggestedCategory: string;
  useSuggestedCategory: boolean;
};

type EditPageProps = {
  params: {
    id: string;
  };
};

const editableStatuses: SubmissionStatus[] = ["draft", "changes_requested", "rejected"];

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

function initialFormState(submission: ProductSubmission): FormState {
  const useSuggestedCategory = !submission.shopify_category_id && Boolean(submission.suggested_category);

  return {
    title: submission.title ?? "",
    description: submission.description ?? "",
    price: submission.price === null ? "" : String(submission.price),
    sku: submission.sku ?? "",
    barcode: submission.barcode ?? "",
    inventoryQuantity:
      submission.inventory_quantity === null ? "" : String(submission.inventory_quantity),
    shopifyCategoryId: submission.shopify_category_id ?? "",
    categorySearch: "",
    suggestedCategory: submission.suggested_category ?? "",
    useSuggestedCategory
  };
}

function validateForm(form: FormState) {
  const errors: string[] = [];
  const price = Number(form.price);
  const inventoryQuantity = Number(form.inventoryQuantity);
  const barcode = form.barcode.trim();

  if (!form.title.trim()) errors.push("Title is required.");
  if (!form.description.trim()) errors.push("Description is required.");
  if (!form.sku.trim()) errors.push("SKU is required.");
  if (barcode && !/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(barcode)) {
    errors.push("Barcode must be 8, 12, 13, or 14 digits.");
  }
  if (!Number.isFinite(price) || price <= 0) errors.push("Price must be greater than 0.");
  if (
    !Number.isInteger(inventoryQuantity) ||
    inventoryQuantity < 0 ||
    form.inventoryQuantity.trim() === ""
  ) {
    errors.push("Inventory quantity must be an integer greater than or equal to 0.");
  }
  if (form.useSuggestedCategory) {
    if (!form.suggestedCategory.trim()) errors.push("Suggested category is required.");
  } else if (!form.shopifyCategoryId) {
    errors.push("Category is required.");
  }

  return errors;
}

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

function EditSubmissionContent({
  submissionId,
  vendor
}: {
  submissionId: string;
  vendor: VendorContext;
}) {
  const [submission, setSubmission] = useState<ProductSubmission | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [images, setImages] = useState<ExistingImage[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const loadSubmission = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("vendor_product_submissions")
      .select("*")
      .eq("id", submissionId)
      .eq("vendor_id", vendor.vendorId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      setSubmission(null);
      setForm(null);
      setImages([]);
      setLoading(false);
      return;
    }

    const nextSubmission = data as ProductSubmission | null;
    setSubmission(nextSubmission);
    setForm(nextSubmission ? initialFormState(nextSubmission) : null);

    if (!nextSubmission) {
      setImages([]);
      setLoading(false);
      return;
    }

    const { data: imageRows, error: imageError } = await supabase
      .from("vendor_product_submission_images")
      .select("id,storage_path,original_filename")
      .eq("submission_id", nextSubmission.id)
      .eq("vendor_id", vendor.vendorId)
      .eq("status", "active")
      .order("sort_order", { ascending: true });

    if (imageError) {
      setError(imageError.message);
      setImages([]);
      setLoading(false);
      return;
    }

    if (!imageRows || imageRows.length === 0) {
      setImages([]);
      setLoading(false);
      return;
    }

    const { data: signedUrls, error: signedUrlError } = await supabase.storage
      .from("vendor-product-images")
      .createSignedUrls(
        imageRows.map((image) => image.storage_path as string),
        3600
      );

    if (signedUrlError) {
      setError(signedUrlError.message);
      setImages([]);
    } else {
      setImages(
        imageRows.map((image, index) => ({
          id: image.id as string,
          url: signedUrls?.[index]?.signedUrl ?? "",
          label: (image.original_filename as string | null) ?? `Image ${index + 1}`
        }))
      );
    }

    setLoading(false);
  }, [submissionId, vendor.vendorId]);

  useEffect(() => {
    let mounted = true;

    async function loadCategories() {
      setLoadingCategories(true);
      const { data, error: loadError } = await supabase
        .from("shopify_collection_categories")
        .select("category_id,name,parent_name")
        .eq("status", "active")
        .order("name", { ascending: true });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setCategories([]);
      } else {
        setCategories((data ?? []) as ProductCategory[]);
      }

      setLoadingCategories(false);
    }

    void loadCategories();
    void loadSubmission();

    return () => {
      mounted = false;
    };
  }, [loadSubmission]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateBarcode(value: string) {
    setForm((current) =>
      current ? { ...current, barcode: value.replace(/\D/g, "").slice(0, 14) } : current
    );
  }

  function updateBooleanField(value: boolean) {
    setForm((current) =>
      current
        ? {
            ...current,
            useSuggestedCategory: value,
            shopifyCategoryId: value ? "" : current.shopifyCategoryId,
            suggestedCategory: value ? current.suggestedCategory : ""
          }
        : current
    );
  }

  async function saveChanges({ submitAfter }: { submitAfter: boolean }) {
    if (!form || !submission) return;

    setSaving(!submitAfter);
    setSubmitting(submitAfter);
    setError(null);
    setMessage(null);
    setValidationErrors([]);

    const nextValidationErrors = validateForm(form);
    if (nextValidationErrors.length > 0) {
      setValidationErrors(nextValidationErrors);
      setSaving(false);
      setSubmitting(false);
      return;
    }

    const { data, error: updateError } = await supabase.rpc("update_product_submission", {
      p_submission_id: submission.id,
      p_title: form.title.trim(),
      p_description: form.description.trim(),
      p_price: Number(form.price),
      p_sku: form.sku.trim(),
      p_barcode: form.barcode.trim() || null,
      p_inventory_quantity: Number(form.inventoryQuantity),
      p_shopify_category_id: form.useSuggestedCategory ? null : form.shopifyCategoryId,
      p_suggested_category: form.useSuggestedCategory ? form.suggestedCategory.trim() : null
    });

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      setSubmitting(false);
      return;
    }

    const updatedSubmission = data as ProductSubmission;
    setSubmission(updatedSubmission);
    setForm(initialFormState(updatedSubmission));

    if (!submitAfter) {
      setMessage("Changes saved.");
      setSaving(false);
      return;
    }

    const { error: submitError } = await supabase.rpc("submit_product_submission", {
      p_submission_id: submission.id
    });

    if (submitError) {
      setError(submitError.message);
      setSubmitting(false);
      return;
    }

    window.location.href = `/submissions/${submission.id}`;
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

  if (!submission || !form) {
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

  const editable = editableStatuses.includes(submission.status);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/submissions/${submission.id}`}
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Submission
        </Link>
        <h1 className="text-2xl font-semibold text-ink">Edit Product Submission</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Update product details for {vendor.vendor.name}. Review notes remain visible until the
          submission is sent back for review.
        </p>
      </div>

      {!editable ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          This submission is {statusLabels[submission.status]} and cannot be edited.
        </section>
      ) : null}

      {submission.status === "changes_requested" && submission.review_notes ? (
        <section className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-900">
          Requested changes: {submission.review_notes}
        </section>
      ) : null}

      {submission.status === "rejected" && submission.review_reason ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
          Rejection reason: {submission.review_reason}
        </section>
      ) : null}

      {message ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {message}
        </section>
      ) : null}

      {error ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </section>
      ) : null}

      {validationErrors.length > 0 ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <div className="font-semibold">Check the product details</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {validationErrors.map((validationError) => (
              <li key={validationError}>{validationError}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <form
        className="rounded-lg border border-line bg-white p-5 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void saveChanges({ submitAfter: false });
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-ink">Title</span>
            <input
              className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink disabled:bg-slate-100"
              disabled={!editable}
              value={form.title}
              onChange={(event) => updateField("title", event.target.value)}
            />
          </label>

          <label className="block md:col-span-2">
            <span className="text-sm font-semibold text-ink">Description</span>
            <textarea
              className="mt-2 min-h-28 w-full rounded-md border border-line px-3 py-2 text-sm text-ink outline-none focus:border-ink disabled:bg-slate-100"
              disabled={!editable}
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Price</span>
            <input
              className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink disabled:bg-slate-100"
              disabled={!editable}
              inputMode="decimal"
              value={form.price}
              onChange={(event) => updateField("price", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">SKU</span>
            <input
              className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink disabled:bg-slate-100"
              disabled={!editable}
              value={form.sku}
              onChange={(event) => updateField("sku", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Inventory quantity</span>
            <input
              className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink disabled:bg-slate-100"
              disabled={!editable}
              inputMode="numeric"
              value={form.inventoryQuantity}
              onChange={(event) => updateField("inventoryQuantity", event.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Barcode (EAN / UPC)</span>
            <input
              className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink disabled:bg-slate-100"
              disabled={!editable}
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.barcode}
              onChange={(event) => updateBarcode(event.target.value)}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Optional. Use 8, 12, 13, or 14 digits.
            </span>
          </label>

          <CategoryPicker
            categories={categories}
            loading={loadingCategories}
            selectedCategoryId={form.shopifyCategoryId}
            search={form.categorySearch}
            suggestedCategory={form.suggestedCategory}
            useSuggestedCategory={form.useSuggestedCategory}
            onSearchChange={(value) => updateField("categorySearch", value)}
            onSelectCategory={(categoryId) => {
              updateField("shopifyCategoryId", categoryId);
              updateField("suggestedCategory", "");
            }}
            onUseSuggestedCategoryChange={updateBooleanField}
            onSuggestedCategoryChange={(value) => updateField("suggestedCategory", value)}
          />

          <section className="md:col-span-2">
            <div className="text-sm font-semibold text-ink">Product images</div>
            <p className="mt-1 text-xs text-slate-500">
              Existing images are preserved. Image replacement is not enabled in this edit pass.
            </p>
            {images.length === 0 ? (
              <div className="mt-2 rounded-md border border-dashed border-line bg-slate-50 px-4 py-6 text-sm font-medium text-slate-600">
                No active product images found.
              </div>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((image) => (
                  <a
                    key={image.id}
                    className="overflow-hidden rounded-md border border-line bg-white text-sm font-semibold text-ink hover:bg-slate-50"
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img alt={image.label} className="h-36 w-full object-cover" src={image.url} />
                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="truncate">{image.label}</span>
                      <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            disabled={!editable || saving || submitting}
            type="submit"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button
            className="h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            disabled={!editable || saving || submitting}
            onClick={() => void saveChanges({ submitAfter: true })}
            type="button"
          >
            {submitting ? "Submitting..." : "Submit for Review"}
          </button>
          <Link
            href={`/submissions/${submission.id}`}
            className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function EditSubmissionPage({ params }: EditPageProps) {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <EditSubmissionContent submissionId={params.id} vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
