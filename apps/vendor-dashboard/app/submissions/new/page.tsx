"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Trash2, Upload } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { supabase } from "@/lib/supabase";

type CreatedSubmission = {
  id: string;
  title: string;
  status: string;
};

type UploadedImage = {
  id: string;
  storagePath: string;
  filename: string;
  contentType: string;
  fileSize: number;
  previewUrl: string;
};

type FormState = {
  title: string;
  description: string;
  price: string;
  sku: string;
  inventoryQuantity: string;
};

const initialFormState: FormState = {
  title: "",
  description: "",
  price: "",
  sku: "",
  inventoryQuantity: ""
};

const maxImages = 6;
const maxImageBytes = 5 * 1024 * 1024;
const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];
const imageBucket = "vendor-product-images";

function validateForm(form: FormState, uploadedImages: UploadedImage[]) {
  const errors: string[] = [];
  const price = Number(form.price);
  const inventoryQuantity = Number(form.inventoryQuantity);

  if (!form.title.trim()) errors.push("Title is required.");
  if (!form.description.trim()) errors.push("Description is required.");
  if (!form.sku.trim()) errors.push("SKU is required.");
  if (!Number.isFinite(price) || price <= 0) errors.push("Price must be greater than 0.");
  if (
    !Number.isInteger(inventoryQuantity) ||
    inventoryQuantity < 0 ||
    form.inventoryQuantity.trim() === ""
  ) {
    errors.push("Inventory quantity must be an integer greater than or equal to 0.");
  }
  if (uploadedImages.length === 0) errors.push("At least one product image is required.");

  return errors;
}

function extensionForFile(file: File) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function validateFiles(files: File[], existingCount: number) {
  const errors: string[] = [];

  if (existingCount + files.length > maxImages) {
    errors.push(`A maximum of ${maxImages} images is allowed.`);
  }

  for (const file of files) {
    if (!allowedImageTypes.includes(file.type)) {
      errors.push(`${file.name} must be a JPG, PNG, or WebP image.`);
    }
    if (file.size > maxImageBytes) {
      errors.push(`${file.name} must be 5 MB or smaller.`);
    }
  }

  return errors;
}

function NewSubmissionContent({ vendor }: { vendor: VendorContext }) {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [createdSubmission, setCreatedSubmission] = useState<CreatedSubmission | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingForReview, setSubmittingForReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    setError(null);
    setValidationErrors([]);

    if (files.length === 0) return;

    const fileErrors = validateFiles(files, uploadedImages.length);
    if (fileErrors.length > 0) {
      setValidationErrors(fileErrors);
      return;
    }

    setUploadingImages(true);

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Authentication is required to upload images.");
      setUploadingImages(false);
      return;
    }

    const nextImages: UploadedImage[] = [];

    for (const file of files) {
      const imageId = crypto.randomUUID();
      const extension = extensionForFile(file);
      const storagePath = `vendors/${vendor.vendorId}/draft-uploads/${imageId}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(imageBucket)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) {
        setError(uploadError.message);
        break;
      }

      const { error: imageError } = await supabase
        .from("vendor_product_submission_images")
        .insert({
          id: imageId,
          vendor_id: vendor.vendorId,
          uploaded_by: user.id,
          storage_bucket: imageBucket,
          storage_path: storagePath,
          original_filename: file.name,
          content_type: file.type,
          file_size_bytes: file.size,
          sort_order: uploadedImages.length + nextImages.length
        });

      if (imageError) {
        await supabase.storage.from(imageBucket).remove([storagePath]);
        setError(imageError.message);
        break;
      }

      nextImages.push({
        id: imageId,
        storagePath,
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
        previewUrl: URL.createObjectURL(file)
      });
    }

    if (nextImages.length > 0) {
      setUploadedImages((current) => [...current, ...nextImages]);
    }

    setUploadingImages(false);
  }

  async function removeImage(image: UploadedImage) {
    setError(null);
    URL.revokeObjectURL(image.previewUrl);

    const { error: metadataError } = await supabase
      .from("vendor_product_submission_images")
      .update({ status: "removed" })
      .eq("id", image.id)
      .eq("vendor_id", vendor.vendorId);

    if (metadataError) {
      setError(metadataError.message);
      return;
    }

    await supabase.storage.from(imageBucket).remove([image.storagePath]);
    setUploadedImages((current) => current.filter((item) => item.id !== image.id));
  }

  async function handleCreateDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setValidationErrors([]);

    const nextValidationErrors = validateForm(form, uploadedImages);
    if (nextValidationErrors.length > 0) {
      setValidationErrors(nextValidationErrors);
      return;
    }

    setSubmitting(true);

    const { data, error: rpcError } = await supabase.rpc("create_product_submission", {
      p_vendor_id: vendor.vendorId,
      p_title: form.title.trim(),
      p_description: form.description.trim(),
      p_images: [],
      p_price: Number(form.price),
      p_sku: form.sku.trim(),
      p_inventory_quantity: Number(form.inventoryQuantity),
      p_image_ids: uploadedImages.map((image) => image.id)
    });

    if (rpcError) {
      setError(rpcError.message);
      setCreatedSubmission(null);
    } else {
      setCreatedSubmission(data as CreatedSubmission);
    }

    setSubmitting(false);
  }

  async function handleSubmitForReview() {
    if (!createdSubmission) return;

    setSubmittingForReview(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("submit_product_submission", {
      p_submission_id: createdSubmission.id
    });

    if (rpcError) {
      setError(rpcError.message);
      setSubmittingForReview(false);
      return;
    }

    window.location.href = `/submissions/${createdSubmission.id}`;
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/submissions"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Product Submissions
        </Link>
        <h1 className="text-2xl font-semibold text-ink">New Product Submission</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Create a product draft for {vendor.vendor.name}. Sinbad reviews submissions before any
          product can move forward.
        </p>
      </div>

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

      {createdSubmission ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="text-base font-semibold text-emerald-900">Draft submission created</h2>
          <p className="mt-2 text-sm text-emerald-800">
            {createdSubmission.title} is saved as a draft. Submit it for review when ready.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              disabled={submittingForReview}
              onClick={handleSubmitForReview}
            >
              {submittingForReview ? "Submitting..." : "Submit for Review"}
            </button>
            <Link
              href={`/submissions/${createdSubmission.id}`}
              className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              View Draft
            </Link>
          </div>
        </section>
      ) : (
        <form
          className="rounded-lg border border-line bg-white p-5 shadow-sm"
          onSubmit={handleCreateDraft}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="text-sm font-semibold text-ink">Title</span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink"
                value={form.title}
                onChange={(event) => updateField("title", event.target.value)}
              />
            </label>

            <label className="block md:col-span-2">
              <span className="text-sm font-semibold text-ink">Description</span>
              <textarea
                className="mt-2 min-h-28 w-full rounded-md border border-line px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-ink">Price</span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink"
                inputMode="decimal"
                value={form.price}
                onChange={(event) => updateField("price", event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-ink">SKU</span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink"
                value={form.sku}
                onChange={(event) => updateField("sku", event.target.value)}
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-ink">Inventory quantity</span>
              <input
                className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink"
                inputMode="numeric"
                value={form.inventoryQuantity}
                onChange={(event) => updateField("inventoryQuantity", event.target.value)}
              />
            </label>

            <div className="md:col-span-2">
              <div className="text-sm font-semibold text-ink">Product images</div>
              <label className="mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line bg-slate-50 px-4 py-6 text-center hover:bg-slate-100">
                <Upload className="h-5 w-5 text-slate-500" aria-hidden="true" />
                <span className="mt-2 text-sm font-semibold text-ink">
                  {uploadingImages ? "Uploading..." : "Upload JPG, PNG, or WebP"}
                </span>
                <span className="mt-1 text-xs text-slate-500">Up to 6 images, 5 MB each</span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={uploadingImages || uploadedImages.length >= maxImages}
                  onChange={handleImageUpload}
                />
              </label>

              {uploadedImages.length > 0 ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {uploadedImages.map((image) => (
                    <div key={image.id} className="rounded-md border border-line bg-white p-2">
                      <img
                        alt={image.filename}
                        className="h-36 w-full rounded object-cover"
                        src={image.previewUrl}
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-ink">
                            {image.filename}
                          </div>
                          <div className="text-xs text-slate-500">
                            {(image.fileSize / 1024 / 1024).toFixed(2)} MB
                          </div>
                        </div>
                        <button
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-slate-600 hover:bg-slate-100"
                          type="button"
                          onClick={() => void removeImage(image)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={submitting || uploadingImages}
              type="submit"
            >
              {submitting ? "Creating..." : "Create Draft Submission"}
            </button>
            <Link
              href="/submissions"
              className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

export default function NewSubmissionPage() {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <NewSubmissionContent vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
