"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type ApplicationStatus = "new" | "under_review" | "needs_changes" | "approved" | "rejected";

type VendorApplication = {
  id: string;
  status: ApplicationStatus;
  company_legal_name: string;
  company_trade_name: string;
  license_number: string | null;
  owner_full_name: string;
  owner_phone: string;
  owner_email: string;
  business_category: string;
  estimated_product_count: number;
  store_description: string;
  pickup_address: string;
  city_area: string;
  bank_name: string;
  account_holder_name: string;
  iban: string;
  trade_license_file_url: string | null;
  civil_id_file_url: string | null;
  store_logo_file_url: string | null;
  accepted_commission: boolean;
  accepted_sinbad_delivery: boolean;
  review_notes: string | null;
  needs_changes_notes: string | null;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_vendor_id: string | null;
  created_vendor_user_id: string | null;
  submitted_ip: string | null;
  submitted_user_agent: string | null;
  application_source: string | null;
  owner_invite_status: "not_sent" | "sent" | "accepted" | "failed";
  owner_invited_at: string | null;
  owner_invited_by: string | null;
  owner_invite_error: string | null;
  owner_auth_user_id: string | null;
  owner_invite_attempt_count: number;
  owner_invite_last_attempt_at: string | null;
  owner_invite_email: string | null;
  owner_invite_redirect_url: string | null;
  created_at: string;
  updated_at: string;
};

type ApplicationDocument = {
  id: string;
  application_id: string | null;
  document_type: "trade_license" | "civil_id" | "store_logo";
  storage_bucket: string;
  storage_path: string;
  original_filename: string | null;
  content_type: string;
  file_size_bytes: number;
  status: string;
  created_at: string;
  signedUrl?: string;
};

type DetailPageProps = {
  params: {
    id: string;
  };
};

const documentLabels: Record<ApplicationDocument["document_type"], string> = {
  trade_license: "Trade license upload",
  civil_id: "ID/Civil ID upload",
  store_logo: "Store logo upload"
};

const statusLabels: Record<ApplicationStatus, string> = {
  new: "New",
  under_review: "Under review",
  needs_changes: "Needs changes",
  approved: "Approved",
  rejected: "Rejected"
};

const statusClasses: Record<ApplicationStatus, string> = {
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  under_review: "bg-amber-50 text-amber-800 ring-amber-200",
  needs_changes: "bg-orange-50 text-orange-800 ring-orange-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200"
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

function fieldValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") return value ? "Accepted" : "Not accepted";
  if (value === null || value === "") return "Not provided";
  return String(value);
}

async function formatFunctionError(error: unknown) {
  const message = error instanceof Error ? error.message : "Edge Function request failed.";
  const context = error && typeof error === "object" && "context" in error ? error.context : null;
  const response = context instanceof Response ? context : null;

  if (!response) return message;

  try {
    const payload = await response.clone().json();
    const code = typeof payload?.error === "string" ? payload.error : null;
    const details =
      typeof payload?.details === "string"
        ? payload.details
        : payload?.details
          ? JSON.stringify(payload.details)
          : null;

    return [code, details].filter(Boolean).join(": ") || message;
  } catch {
    try {
      const text = await response.clone().text();
      return text || message;
    } catch {
      return message;
    }
  }
}

function DetailField({
  label,
  value
}: {
  label: string;
  value: string | number | boolean | null;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-ink">{fieldValue(value)}</dd>
    </div>
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
      <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </section>
  );
}

function DocumentLink({ label, href }: { label: string; href: string | null }) {
  if (!href) {
    return <DetailField label={label} value={null} />;
  }

  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1">
        <a
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink underline underline-offset-4"
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          Open document
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </dd>
    </div>
  );
}

function StoredDocumentLink({
  document
}: {
  document: ApplicationDocument;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">
        {documentLabels[document.document_type]}
      </dt>
      <dd className="mt-1">
        {document.signedUrl ? (
          <a
            className="inline-flex items-center gap-2 text-sm font-semibold text-ink underline underline-offset-4"
            href={document.signedUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open private document
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-sm font-medium text-slate-500">Preview unavailable</span>
        )}
        <div className="mt-1 break-words text-xs text-slate-500">
          {document.original_filename ?? document.storage_path}
        </div>
        <div className="text-xs text-slate-500">
          {(document.file_size_bytes / 1024 / 1024).toFixed(2)} MB
        </div>
      </dd>
    </div>
  );
}

function ApplicationDetail({
  applicationId,
  adminRole
}: {
  applicationId: string;
  adminRole: string;
}) {
  const [application, setApplication] = useState<VendorApplication | null>(null);
  const [documents, setDocuments] = useState<ApplicationDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadApplication = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("vendor_applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      setApplication(null);
      setDocuments([]);
    } else {
      setApplication(data as unknown as VendorApplication | null);

      const { data: documentRows, error: documentError } = await supabase
        .from("vendor_application_documents")
        .select("*")
        .eq("application_id", applicationId)
        .eq("status", "active")
        .order("document_type");

      if (documentError) {
        setError(documentError.message);
        setDocuments([]);
      } else {
        const signedDocuments = await Promise.all(
          ((documentRows ?? []) as ApplicationDocument[]).map(async (document) => {
            const { data: signedUrlData } = await supabase.storage
              .from(document.storage_bucket)
              .createSignedUrl(document.storage_path, 300);

            return {
              ...document,
              signedUrl: signedUrlData?.signedUrl
            };
          })
        );

        setDocuments(signedDocuments);
      }
    }

    setLoading(false);
  }, [applicationId]);

  useEffect(() => {
    void loadApplication();
  }, [loadApplication]);

  async function runAction(
    label: string,
    rpcName:
      | "mark_vendor_application_under_review"
      | "request_vendor_application_changes"
      | "approve_vendor_application"
      | "reject_vendor_application",
    args: Record<string, string | null>
  ) {
    setActionLoading(label);
    setError(null);
    setActionMessage(null);

    const { error: rpcError } = await supabase.rpc(rpcName, args);

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setActionMessage(`${label} completed.`);
      await loadApplication();
    }

    setActionLoading(null);
  }

  function handleUnderReview() {
    void runAction("Mark under review", "mark_vendor_application_under_review", {
      application_id: applicationId
    });
  }

  function handleNeedsChanges() {
    const notes = window.prompt("Enter the changes needed for this application:");
    if (!notes || notes.trim().length === 0) return;

    void runAction("Request changes", "request_vendor_application_changes", {
      application_id: applicationId,
      notes: notes.trim()
    });
  }

  function handleApprove() {
    const confirmed = window.confirm(
      "Approve this vendor application? This creates the vendor account and links owner access if the owner email already exists in Auth."
    );
    if (!confirmed) return;

    const notes = window.prompt("Optional approval notes:");

    void runAction("Approve", "approve_vendor_application", {
      application_id: applicationId,
      notes: notes?.trim() || null
    });
  }

  function handleReject() {
    const reason = window.prompt("Enter the rejection reason:");
    if (!reason || reason.trim().length === 0) return;

    const confirmed = window.confirm("Reject this vendor application?");
    if (!confirmed) return;

    void runAction("Reject", "reject_vendor_application", {
      application_id: applicationId,
      reason: reason.trim()
    });
  }

  async function handleSendOwnerInvite() {
    if (!application) return;

    const confirmed = window.confirm(
      `Send Vendor Dashboard access invite to ${application.owner_email}?`
    );
    if (!confirmed) return;

    setActionLoading("Send owner invite");
    setError(null);
    setActionMessage(null);

    const { error: functionError } = await supabase.functions.invoke("invite-vendor-owner", {
      body: {
        application_id: application.id
      }
    });

    if (functionError) {
      setError(await formatFunctionError(functionError));
    } else {
      setActionMessage("Vendor owner invite completed.");
      await loadApplication();
    }

    setActionLoading(null);
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading application...</div>
      </section>
    );
  }

  if (error && !application) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load application</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/applications"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Applications
        </Link>
      </section>
    );
  }

  if (!application) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Application not found</h1>
        <Link
          href="/applications"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Applications
        </Link>
      </section>
    );
  }

  const terminal = application.status === "approved" || application.status === "rejected";
  const canInviteOwner =
    application.status === "approved" &&
    Boolean(application.approved_vendor_id) &&
    ["owner", "admin"].includes(adminRole) &&
    (application.owner_invite_status === "not_sent" ||
      application.owner_invite_status === "failed");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/applications"
            className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Applications
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">{application.company_trade_name}</h1>
            <span
              className={[
                "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                statusClasses[application.status]
              ].join(" ")}
            >
              {statusLabels[application.status]}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Submitted {formatDate(application.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {!terminal ? (
            <>
              {application.status !== "under_review" ? (
                <button
                  className="h-9 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  disabled={Boolean(actionLoading)}
                  onClick={handleUnderReview}
                >
                  Mark under review
                </button>
              ) : null}
              <button
                className="h-9 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                disabled={Boolean(actionLoading)}
                onClick={handleNeedsChanges}
              >
                Request changes
              </button>
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
            </>
          ) : null}
          {canInviteOwner ? (
            <button
              className="h-9 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              disabled={Boolean(actionLoading)}
              onClick={() => void handleSendOwnerInvite()}
            >
              Send Owner Invite
            </button>
          ) : null}
        </div>
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

      <Section title="Company">
        <DetailField label="Legal name" value={application.company_legal_name} />
        <DetailField label="Trade name" value={application.company_trade_name} />
        <DetailField label="License number" value={application.license_number} />
      </Section>

      <Section title="Owner">
        <DetailField label="Full name" value={application.owner_full_name} />
        <DetailField label="Phone number" value={application.owner_phone} />
        <DetailField label="Email address" value={application.owner_email} />
      </Section>

      <Section title="Store">
        <DetailField label="Business category" value={application.business_category} />
        <DetailField label="Estimated product count" value={application.estimated_product_count} />
        <DetailField label="Short description" value={application.store_description} />
      </Section>

      <Section title="Operations">
        <DetailField label="Pickup address" value={application.pickup_address} />
        <DetailField label="City/Area" value={application.city_area} />
      </Section>

      <Section title="Payout">
        <DetailField label="Bank name" value={application.bank_name} />
        <DetailField label="Account holder name" value={application.account_holder_name} />
        <DetailField label="IBAN" value={application.iban} />
      </Section>

      <Section title="Documents">
        {documents.length > 0 ? (
          documents.map((document) => <StoredDocumentLink key={document.id} document={document} />)
        ) : (
          <>
            <DocumentLink label="Trade license upload" href={application.trade_license_file_url} />
            <DocumentLink label="ID/Civil ID upload" href={application.civil_id_file_url} />
            <DocumentLink label="Store logo upload" href={application.store_logo_file_url} />
          </>
        )}
      </Section>

      <Section title="Agreement">
        <DetailField label="Accept 5% commission" value={application.accepted_commission} />
        <DetailField
          label="Accept Sinbad-managed delivery"
          value={application.accepted_sinbad_delivery}
        />
      </Section>

      <Section title="Review Status">
        <DetailField label="Current status" value={statusLabels[application.status]} />
        <DetailField label="Reviewed at" value={formatDate(application.reviewed_at)} />
        <DetailField label="Reviewed by" value={application.reviewed_by} />
        <DetailField label="Review notes" value={application.review_notes} />
        <DetailField label="Needs changes notes" value={application.needs_changes_notes} />
        <DetailField label="Rejection reason" value={application.rejection_reason} />
        <DetailField label="Approved vendor ID" value={application.approved_vendor_id} />
        <DetailField label="Created vendor user ID" value={application.created_vendor_user_id} />
        <DetailField label="Submitted IP" value={application.submitted_ip} />
        <DetailField label="Submitted user agent" value={application.submitted_user_agent} />
        <DetailField label="Application source" value={application.application_source} />
        <DetailField label="Updated at" value={formatDate(application.updated_at)} />
      </Section>

      <Section title="Owner Invite">
        <DetailField label="Invite status" value={application.owner_invite_status} />
        <DetailField label="Owner Auth user ID" value={application.owner_auth_user_id} />
        <DetailField label="Invite email" value={application.owner_invite_email} />
        <DetailField label="Invited at" value={formatDate(application.owner_invited_at)} />
        <DetailField label="Invited by" value={application.owner_invited_by} />
        <DetailField
          label="Last attempt"
          value={formatDate(application.owner_invite_last_attempt_at)}
        />
        <DetailField label="Attempt count" value={application.owner_invite_attempt_count} />
        <DetailField label="Redirect URL" value={application.owner_invite_redirect_url} />
        <DetailField label="Invite error" value={application.owner_invite_error} />
      </Section>
    </div>
  );
}

export default function ApplicationDetailPage({ params }: DetailPageProps) {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <ApplicationDetail applicationId={params.id} adminRole={admin.role} />
        </AdminShell>
      )}
    </AuthGate>
  );
}
