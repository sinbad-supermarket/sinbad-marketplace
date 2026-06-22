"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
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
  title: string;
  price: number | null;
  sku: string | null;
  inventory_quantity: number | null;
  status: SubmissionStatus;
  reviewed_at: string | null;
  created_at: string;
};

const filters: Array<{ label: string; value: "all" | SubmissionStatus }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Submitted", value: "submitted" },
  { label: "Under review", value: "under_review" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" }
];

const statusLabels: Record<SubmissionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
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
  if (!value) return "Not reviewed";
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

function SubmissionsContent({ vendor }: { vendor: VendorContext }) {
  const [submissions, setSubmissions] = useState<ProductSubmission[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | SubmissionStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadSubmissions() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("vendor_product_submissions")
        .select("id,title,price,sku,inventory_quantity,status,reviewed_at,created_at")
        .eq("vendor_id", vendor.vendorId)
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setSubmissions([]);
      } else {
        setSubmissions((data ?? []) as ProductSubmission[]);
      }

      setLoading(false);
    }

    void loadSubmissions();

    return () => {
      mounted = false;
    };
  }, [vendor.vendorId]);

  const filteredSubmissions = useMemo(() => {
    if (activeFilter === "all") return submissions;
    return submissions.filter((submission) => submission.status === activeFilter);
  }, [activeFilter, submissions]);

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Product Submissions</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Create and submit products for Sinbad review. Approved products are still managed by
            Sinbad before any store publishing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium text-slate-600">
            {filteredSubmissions.length} shown
          </div>
          <Link
            href="/submissions/new"
            className="inline-flex h-9 items-center gap-2 rounded-md bg-ink px-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Submission
          </Link>
        </div>
      </section>

      <section className="mb-4 flex flex-wrap gap-2">
        {filters.map((filter) => {
          const active = activeFilter === filter.value;
          return (
            <button
              key={filter.value}
              className={[
                "h-9 rounded-md border px-3 text-sm font-semibold",
                active
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-white text-slate-700 hover:bg-slate-100"
              ].join(" ")}
              onClick={() => setActiveFilter(filter.value)}
            >
              {filter.label}
            </button>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-sm font-medium text-slate-600">Loading submissions...</div>
        ) : error ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-rose-700">Could not load submissions</h2>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        ) : filteredSubmissions.length === 0 ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-ink">No product submissions found</h2>
            <p className="mt-2 text-sm text-slate-600">
              Create a new product submission when product details are ready for review.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[940px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Price</th>
                  <th className="px-4 py-3 font-semibold">SKU</th>
                  <th className="px-4 py-3 font-semibold">Inventory</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">Reviewed date</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredSubmissions.map((submission) => (
                  <tr
                    key={submission.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      window.location.href = `/submissions/${submission.id}`;
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                          statusClasses[submission.status]
                        ].join(" ")}
                      >
                        {statusLabels[submission.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{submission.title}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(submission.price)}</td>
                    <td className="px-4 py-3 text-slate-700">{submission.sku ?? "Not set"}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {submission.inventory_quantity ?? "Not set"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(submission.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(submission.reviewed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/submissions/${submission.id}`}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        onClick={(event) => event.stopPropagation()}
                      >
                        View
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function SubmissionsPage() {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <SubmissionsContent vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
