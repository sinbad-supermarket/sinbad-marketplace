"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type CommissionStatus = "pending" | "approved" | "paid" | "void";

type Commission = {
  id: string;
  vendor_id: string;
  vendor_order_item_id: string;
  rate: number;
  amount: number;
  status: CommissionStatus;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  vendors: {
    name: string;
    slug: string;
  } | null;
  vendor_order_items: {
    shopify_line_item_id: string;
    shopify_product_id: string | null;
    shopify_variant_id: string | null;
  } | null;
};

const filters: Array<{ label: string; value: "all" | CommissionStatus }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Paid", value: "paid" },
  { label: "Void", value: "void" }
];

const statusLabels: Record<CommissionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  void: "Void"
};

const statusClasses: Record<CommissionStatus, string> = {
  pending: "bg-sky-50 text-sky-700 ring-sky-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  paid: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  void: "bg-rose-50 text-rose-700 ring-rose-200"
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

function formatRate(value: number | null) {
  if (value === null) return "Not set";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function orderItemLabel(commission: Commission) {
  const item = commission.vendor_order_items;
  if (!item) return "Not available";
  return item.shopify_product_id ?? item.shopify_line_item_id;
}

function CommissionsContent() {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | CommissionStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadCommissions() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("vendor_commissions")
        .select(
          [
            "id",
            "vendor_id",
            "vendor_order_item_id",
            "rate",
            "amount",
            "status",
            "approved_at",
            "paid_at",
            "created_at",
            "vendors(name,slug)",
            "vendor_order_items(shopify_line_item_id,shopify_product_id,shopify_variant_id)"
          ].join(",")
        )
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setCommissions([]);
      } else {
        setCommissions((data ?? []) as unknown as Commission[]);
      }

      setLoading(false);
    }

    void loadCommissions();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredCommissions = useMemo(() => {
    if (activeFilter === "all") return commissions;
    return commissions.filter((commission) => commission.status === activeFilter);
  }, [activeFilter, commissions]);

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Commissions</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Review and manage commission status through audited workflow actions.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">
          {filteredCommissions.length} shown
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
          <div className="p-8 text-sm font-medium text-slate-600">Loading commissions...</div>
        ) : error ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-rose-700">Could not load commissions</h2>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        ) : filteredCommissions.length === 0 ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-ink">No commissions found</h2>
            <p className="mt-2 text-sm text-slate-600">
              Commission rows will appear here after Shopify order attribution is implemented.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1020px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Order item</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Rate</th>
                  <th className="px-4 py-3 font-semibold">Approved date</th>
                  <th className="px-4 py-3 font-semibold">Paid date</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredCommissions.map((commission) => (
                  <tr
                    key={commission.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      window.location.href = `/commissions/${commission.id}`;
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                          statusClasses[commission.status]
                        ].join(" ")}
                      >
                        {statusLabels[commission.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {commission.vendors?.name ?? "Unknown vendor"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{orderItemLabel(commission)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatMoney(commission.amount)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatRate(commission.rate)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(commission.approved_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(commission.paid_at)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(commission.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/commissions/${commission.id}`}
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

export default function CommissionsPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <CommissionsContent />
        </AdminShell>
      )}
    </AuthGate>
  );
}
