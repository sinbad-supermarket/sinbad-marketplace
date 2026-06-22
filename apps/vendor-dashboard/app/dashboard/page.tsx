"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  ClipboardList,
  PackageCheck,
  ReceiptText,
  WalletCards
} from "lucide-react";
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

type RecentSubmission = {
  id: string;
  title: string;
  status: SubmissionStatus;
  created_at: string;
};

type DashboardSummary = {
  submissionsCount: number;
  approvedProductsCount: number;
  ordersCount: number;
  pendingCommissionsTotal: number;
  approvedCommissionsTotal: number;
  paidCommissionsTotal: number;
};

type CommissionTotalRow = {
  status: "pending" | "approved" | "paid" | "void";
  amount: number;
};

const initialSummary: DashboardSummary = {
  submissionsCount: 0,
  approvedProductsCount: 0,
  ordersCount: 0,
  pendingCommissionsTotal: 0,
  approvedCommissionsTotal: 0,
  paidCommissionsTotal: 0
};

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
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 0
  }).format(value);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(value);
}

function SummaryCard({
  label,
  value,
  helper,
  icon: Icon
}: {
  label: string;
  value: string;
  helper: string;
  icon: React.ElementType;
}) {
  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-500">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
          <div className="mt-2 text-xs font-medium text-slate-500">{helper}</div>
        </div>
        <Icon className="h-5 w-5 text-slate-500" aria-hidden="true" />
      </div>
    </article>
  );
}

function DashboardContent({ vendor }: { vendor: VendorContext }) {
  const [summary, setSummary] = useState<DashboardSummary>(initialSummary);
  const [recentSubmissions, setRecentSubmissions] = useState<RecentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      setLoading(true);
      setError(null);

      const [
        submissionsResult,
        approvedProductsResult,
        ordersResult,
        commissionsResult,
        recentSubmissionsResult
      ] = await Promise.all([
        supabase
          .from("vendor_product_submissions")
          .select("id", { count: "exact", head: true })
          .eq("vendor_id", vendor.vendorId),
        supabase
          .from("vendor_products")
          .select("id", { count: "exact", head: true })
          .eq("vendor_id", vendor.vendorId)
          .eq("status", "approved"),
        supabase
          .from("vendor_orders")
          .select("id", { count: "exact", head: true })
          .eq("vendor_id", vendor.vendorId),
        supabase
          .from("vendor_commissions")
          .select("status,amount")
          .eq("vendor_id", vendor.vendorId)
          .in("status", ["pending", "approved", "paid"]),
        supabase
          .from("vendor_product_submissions")
          .select("id,title,status,created_at")
          .eq("vendor_id", vendor.vendorId)
          .order("created_at", { ascending: false })
          .limit(5)
      ]);

      if (!mounted) return;

      const firstError =
        submissionsResult.error ??
        approvedProductsResult.error ??
        ordersResult.error ??
        commissionsResult.error ??
        recentSubmissionsResult.error;

      if (firstError) {
        setError(firstError.message);
        setSummary(initialSummary);
        setRecentSubmissions([]);
        setLoading(false);
        return;
      }

      const commissionTotals = ((commissionsResult.data ?? []) as CommissionTotalRow[]).reduce(
        (totals, row) => {
          if (row.status === "pending") {
            totals.pendingCommissionsTotal += Number(row.amount);
          } else if (row.status === "approved") {
            totals.approvedCommissionsTotal += Number(row.amount);
          } else if (row.status === "paid") {
            totals.paidCommissionsTotal += Number(row.amount);
          }
          return totals;
        },
        {
          pendingCommissionsTotal: 0,
          approvedCommissionsTotal: 0,
          paidCommissionsTotal: 0
        }
      );

      setSummary({
        submissionsCount: submissionsResult.count ?? 0,
        approvedProductsCount: approvedProductsResult.count ?? 0,
        ordersCount: ordersResult.count ?? 0,
        ...commissionTotals
      });
      setRecentSubmissions((recentSubmissionsResult.data ?? []) as RecentSubmission[]);
      setLoading(false);
    }

    void loadDashboard();

    return () => {
      mounted = false;
    };
  }, [vendor.vendorId]);

  const cards = useMemo(
    () => [
      {
        label: "Product submissions",
        value: loading ? "..." : formatCount(summary.submissionsCount),
        helper: "All submissions",
        icon: ClipboardList
      },
      {
        label: "Approved products",
        value: loading ? "..." : formatCount(summary.approvedProductsCount),
        helper: "Internal approved products",
        icon: PackageCheck
      },
      {
        label: "Orders",
        value: loading ? "..." : formatCount(summary.ordersCount),
        helper: "Vendor-attributed orders",
        icon: ReceiptText
      },
      {
        label: "Pending commissions",
        value: loading ? "..." : formatMoney(summary.pendingCommissionsTotal),
        helper: "Awaiting finance review",
        icon: WalletCards
      },
      {
        label: "Approved commissions",
        value: loading ? "..." : formatMoney(summary.approvedCommissionsTotal),
        helper: "Approved but unpaid",
        icon: WalletCards
      },
      {
        label: "Paid commissions",
        value: loading ? "..." : formatMoney(summary.paidCommissionsTotal),
        helper: "Marked paid",
        icon: WalletCards
      }
    ],
    [loading, summary]
  );

  return (
    <>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold text-ink">Home</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Vendor-scoped overview for submissions, products, orders, and commissions.
        </p>
      </section>

      {error ? (
        <section className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-5">
          <h2 className="text-base font-semibold text-rose-700">Could not load dashboard</h2>
          <p className="mt-2 text-sm text-slate-700">{error}</p>
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            helper={card.helper}
            icon={card.icon}
          />
        ))}
      </section>

      <section className="mt-6 overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Recent Product Submissions</h2>
            <p className="mt-1 text-sm text-slate-600">Latest five submissions for this vendor.</p>
          </div>
          <Link
            href="/submissions"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            View all
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        {loading ? (
          <div className="p-8 text-sm font-medium text-slate-600">Loading recent submissions...</div>
        ) : error ? (
          <div className="p-8 text-sm font-medium text-slate-600">
            Recent submissions are unavailable.
          </div>
        ) : recentSubmissions.length === 0 ? (
          <div className="p-8">
            <h3 className="text-base font-semibold text-ink">No recent submissions</h3>
            <p className="mt-2 text-sm text-slate-600">
              New product submissions will appear here after they are created.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recentSubmissions.map((submission) => (
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
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(submission.created_at)}
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

export default function DashboardPage() {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <DashboardContent vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
