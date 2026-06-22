"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, FileUp, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type DocumentType = "trade_license" | "civil_id" | "store_logo";

type FormState = {
  companyLegalName: string;
  companyTradeName: string;
  licenseNumber: string;
  ownerFullName: string;
  ownerPhone: string;
  ownerEmail: string;
  businessCategory: string;
  estimatedProductCount: string;
  storeDescription: string;
  pickupAddress: string;
  cityArea: string;
  bankName: string;
  accountHolderName: string;
  iban: string;
  acceptedCommission: boolean;
  acceptedSinbadDelivery: boolean;
};

type UploadSession = {
  id: string;
  upload_token: string;
  expires_at: string;
};

type UploadedDocument = {
  id: string;
  documentType: DocumentType;
  storagePath: string;
  filename: string;
  contentType: string;
  fileSize: number;
};

const initialForm: FormState = {
  companyLegalName: "",
  companyTradeName: "",
  licenseNumber: "",
  ownerFullName: "",
  ownerPhone: "",
  ownerEmail: "",
  businessCategory: "",
  estimatedProductCount: "",
  storeDescription: "",
  pickupAddress: "",
  cityArea: "",
  bankName: "",
  accountHolderName: "",
  iban: "",
  acceptedCommission: false,
  acceptedSinbadDelivery: false
};

const documentBucket = "vendor-application-documents";
const maxDocumentBytes = 10 * 1024 * 1024;
const allowedDocumentTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const documentLabels: Record<DocumentType, string> = {
  trade_license: "Trade license",
  civil_id: "ID / Civil ID",
  store_logo: "Store logo"
};

const documentHelp: Record<DocumentType, string> = {
  trade_license: "PDF, JPG, PNG, or WebP. Max 10 MB.",
  civil_id: "PDF, JPG, PNG, or WebP. Max 10 MB.",
  store_logo: "JPG, PNG, WebP, or PDF. Max 10 MB."
};

function extensionForFile(file: File) {
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function validateForm(form: FormState, documents: Partial<Record<DocumentType, UploadedDocument>>) {
  const errors: string[] = [];
  const estimatedProductCount = Number(form.estimatedProductCount);

  if (!form.companyLegalName.trim()) errors.push("Legal/business name is required.");
  if (!form.companyTradeName.trim()) errors.push("Trade name is required.");
  if (!form.ownerFullName.trim()) errors.push("Owner full name is required.");
  if (!form.ownerPhone.trim()) errors.push("Owner phone is required.");
  if (!form.ownerEmail.trim() || !form.ownerEmail.includes("@")) {
    errors.push("A valid owner email address is required.");
  }
  if (!form.businessCategory.trim()) errors.push("Business category is required.");
  if (
    form.estimatedProductCount.trim() === "" ||
    !Number.isInteger(estimatedProductCount) ||
    estimatedProductCount < 0
  ) {
    errors.push("Estimated product count must be an integer greater than or equal to 0.");
  }
  if (!form.storeDescription.trim()) errors.push("Store description is required.");
  if (!form.pickupAddress.trim()) errors.push("Pickup address is required.");
  if (!form.cityArea.trim()) errors.push("City/area is required.");
  if (!form.bankName.trim()) errors.push("Bank name is required.");
  if (!form.accountHolderName.trim()) errors.push("Account holder name is required.");
  if (!form.iban.trim()) errors.push("IBAN is required.");
  if (!documents.trade_license) errors.push("Trade license upload is required.");
  if (!documents.civil_id) errors.push("ID / Civil ID upload is required.");
  if (!documents.store_logo) errors.push("Store logo upload is required.");
  if (!form.acceptedCommission) errors.push("You must accept the 5% commission agreement.");
  if (!form.acceptedSinbadDelivery) {
    errors.push("You must accept Sinbad-managed delivery in V1.");
  }

  return errors;
}

function validateFile(file: File) {
  if (!allowedDocumentTypes.includes(file.type)) {
    return `${file.name} must be a PDF, JPG, PNG, or WebP file.`;
  }
  if (file.size > maxDocumentBytes) {
    return `${file.name} must be 10 MB or smaller.`;
  }
  return null;
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  required = true
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">
        {label}
        {required ? "" : " (optional)"}
      </span>
      <input
        className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

export default function ApplyPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [uploadSession, setUploadSession] = useState<UploadSession | null>(null);
  const [documents, setDocuments] = useState<Partial<Record<DocumentType, UploadedDocument>>>({});
  const [uploadingDocument, setUploadingDocument] = useState<DocumentType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function updateField(field: keyof FormState, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function getUploadSession() {
    if (uploadSession) return uploadSession;

    const { data, error: sessionError } = await supabase.rpc(
      "create_vendor_application_upload_session",
      {
        p_submitted_ip: null,
        p_submitted_user_agent:
          typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 500)
      }
    );

    if (sessionError) throw new Error(sessionError.message);

    const nextSession = data as UploadSession;
    setUploadSession(nextSession);
    return nextSession;
  }

  async function handleDocumentUpload(
    documentType: DocumentType,
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setError(null);
    setValidationErrors([]);

    if (!file) return;

    const fileError = validateFile(file);
    if (fileError) {
      setValidationErrors([fileError]);
      return;
    }

    setUploadingDocument(documentType);

    try {
      const session = await getUploadSession();
      const documentId = crypto.randomUUID();
      const extension = extensionForFile(file);
      const storagePath = `applications/${session.id}/${session.upload_token}/${documentType}/${documentId}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(documentBucket)
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) throw new Error(uploadError.message);

      const { error: documentError } = await supabase.from("vendor_application_documents").insert({
        id: documentId,
        upload_session_id: session.id,
        upload_token: session.upload_token,
        document_type: documentType,
        storage_bucket: documentBucket,
        storage_path: storagePath,
        original_filename: file.name,
        content_type: file.type,
        file_size_bytes: file.size
      });

      if (documentError) {
        await supabase.storage.from(documentBucket).remove([storagePath]);
        throw new Error(documentError.message);
      }

      const previous = documents[documentType];
      if (previous) {
        await supabase.storage.from(documentBucket).remove([previous.storagePath]);
      }

      setDocuments((current) => ({
        ...current,
        [documentType]: {
          id: documentId,
          documentType,
          storagePath,
          filename: file.name,
          contentType: file.type,
          fileSize: file.size
        }
      }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Document upload failed.");
    }

    setUploadingDocument(null);
  }

  async function removeDocument(documentType: DocumentType) {
    const document = documents[documentType];
    if (!document) return;

    setDocuments((current) => {
      const next = { ...current };
      delete next[documentType];
      return next;
    });

    await supabase
      .from("vendor_application_documents")
      .update({ status: "removed" })
      .eq("id", document.id);
    await supabase.storage.from(documentBucket).remove([document.storagePath]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setValidationErrors([]);

    const nextValidationErrors = validateForm(form, documents);
    if (nextValidationErrors.length > 0) {
      setValidationErrors(nextValidationErrors);
      return;
    }

    setSubmitting(true);

    const { error: submitError } = await supabase.rpc("submit_vendor_application", {
      p_company_legal_name: form.companyLegalName.trim(),
      p_company_trade_name: form.companyTradeName.trim(),
      p_license_number: form.licenseNumber.trim() || null,
      p_owner_full_name: form.ownerFullName.trim(),
      p_owner_phone: form.ownerPhone.trim(),
      p_owner_email: form.ownerEmail.trim(),
      p_business_category: form.businessCategory.trim(),
      p_estimated_product_count: Number(form.estimatedProductCount),
      p_store_description: form.storeDescription.trim(),
      p_pickup_address: form.pickupAddress.trim(),
      p_city_area: form.cityArea.trim(),
      p_bank_name: form.bankName.trim(),
      p_account_holder_name: form.accountHolderName.trim(),
      p_iban: form.iban.trim(),
      p_trade_license_file_url: null,
      p_civil_id_file_url: null,
      p_store_logo_file_url: null,
      p_accepted_commission: form.acceptedCommission,
      p_accepted_sinbad_delivery: form.acceptedSinbadDelivery,
      p_submitted_ip: null,
      p_submitted_user_agent:
        typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 500),
      p_application_source: "vendor_dashboard_apply",
      p_document_ids: [
        documents.trade_license?.id,
        documents.civil_id?.id,
        documents.store_logo?.id
      ].filter(Boolean)
    });

    if (submitError) {
      setError(submitError.message);
      setSubmitting(false);
      return;
    }

    window.location.href = "/apply/success";
  }

  return (
    <main className="min-h-screen bg-panel px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase text-slate-500">Sinbad Vendors</div>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Apply to Sell on Sinbad</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Submit your vendor application for manual review. Dashboard access is granted only
              after approval.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Vendor Login
          </Link>
        </div>

        {error ? (
          <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {error}
          </section>
        ) : null}

        {validationErrors.length > 0 ? (
          <section className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <div className="font-semibold">Check the application</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {validationErrors.map((validationError) => (
                <li key={validationError}>{validationError}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <form className="space-y-5" onSubmit={handleSubmit}>
          <Section title="Company Info">
            <TextInput
              label="Legal / business name"
              value={form.companyLegalName}
              onChange={(value) => updateField("companyLegalName", value)}
            />
            <TextInput
              label="Trade name"
              value={form.companyTradeName}
              onChange={(value) => updateField("companyTradeName", value)}
            />
            <TextInput
              label="License number"
              required={false}
              value={form.licenseNumber}
              onChange={(value) => updateField("licenseNumber", value)}
            />
          </Section>

          <Section title="Owner Info">
            <TextInput
              label="Owner full name"
              value={form.ownerFullName}
              onChange={(value) => updateField("ownerFullName", value)}
            />
            <TextInput
              label="Phone"
              value={form.ownerPhone}
              onChange={(value) => updateField("ownerPhone", value)}
            />
            <TextInput
              label="Email"
              type="email"
              value={form.ownerEmail}
              onChange={(value) => updateField("ownerEmail", value)}
            />
          </Section>

          <Section title="Store Info">
            <TextInput
              label="Business category"
              value={form.businessCategory}
              onChange={(value) => updateField("businessCategory", value)}
            />
            <TextInput
              label="Estimated product count"
              value={form.estimatedProductCount}
              onChange={(value) => updateField("estimatedProductCount", value)}
            />
            <label className="block md:col-span-2">
              <span className="text-sm font-semibold text-ink">Business description</span>
              <textarea
                className="mt-2 min-h-28 w-full rounded-md border border-line px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                value={form.storeDescription}
                onChange={(event) => updateField("storeDescription", event.target.value)}
              />
            </label>
          </Section>

          <Section title="Operations / Address">
            <TextInput
              label="Pickup address"
              value={form.pickupAddress}
              onChange={(value) => updateField("pickupAddress", value)}
            />
            <TextInput
              label="City / Area"
              value={form.cityArea}
              onChange={(value) => updateField("cityArea", value)}
            />
          </Section>

          <Section title="Payout / Bank Info">
            <TextInput
              label="Bank name"
              value={form.bankName}
              onChange={(value) => updateField("bankName", value)}
            />
            <TextInput
              label="Account holder name"
              value={form.accountHolderName}
              onChange={(value) => updateField("accountHolderName", value)}
            />
            <TextInput
              label="IBAN"
              value={form.iban}
              onChange={(value) => updateField("iban", value)}
            />
          </Section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-ink">Document Uploads</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {(Object.keys(documentLabels) as DocumentType[]).map((documentType) => {
                const document = documents[documentType];
                return (
                  <div key={documentType} className="rounded-md border border-line p-4">
                    <div className="text-sm font-semibold text-ink">
                      {documentLabels[documentType]}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{documentHelp[documentType]}</div>

                    {document ? (
                      <div className="mt-4 rounded-md bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              Uploaded
                            </div>
                            <div className="mt-1 truncate text-xs text-slate-600">
                              {document.filename}
                            </div>
                            <div className="text-xs text-slate-500">
                              {(document.fileSize / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                          <button
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line text-slate-600 hover:bg-white"
                            type="button"
                            onClick={() => void removeDocument(documentType)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line bg-slate-50 px-3 py-5 text-center hover:bg-slate-100">
                        <FileUp className="h-5 w-5 text-slate-500" aria-hidden="true" />
                        <span className="mt-2 text-sm font-semibold text-ink">
                          {uploadingDocument === documentType ? "Uploading..." : "Upload file"}
                        </span>
                        <input
                          className="sr-only"
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp"
                          disabled={uploadingDocument !== null}
                          onChange={(event) => void handleDocumentUpload(documentType, event)}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-ink">Agreement</h2>
            <div className="mt-4 space-y-3">
              <label className="flex gap-3 text-sm text-slate-700">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={form.acceptedCommission}
                  onChange={(event) => updateField("acceptedCommission", event.target.checked)}
                />
                <span>I accept the 5% Sinbad commission for V1 vendor sales.</span>
              </label>
              <label className="flex gap-3 text-sm text-slate-700">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={form.acceptedSinbadDelivery}
                  onChange={(event) => updateField("acceptedSinbadDelivery", event.target.checked)}
                />
                <span>I accept Sinbad-managed delivery in V1.</span>
              </label>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              className="h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={submitting || uploadingDocument !== null}
              type="submit"
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}
