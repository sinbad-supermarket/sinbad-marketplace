"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { supabase } from "@/lib/supabase";

type CommissionStatus = "pending" | "approved" | "paid" | "void";

type Commission = {
  id: string;
  vendor_order_item_id: string;
  rate: number;
  amount: number;
  status: CommissionStatus;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  vendor_order_items: {
    id: string;
    vendor_order_id: string;
    shopify_line_item_id: string;
    shopify_product_id: string | null;
    shopify_variant_id: string | null;
    vendor_orders: {
      shopify_order_number: string | null;
      shopify_order_id: string;
      currency: string | null;
    } | null;
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
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  paid: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  void: "bg-zinc-100 text-zinc-700 ring-zinc-200"
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

function formatMoney(value: number | null, currency: string | null) {
  if (value === null) return "Not set";
  const amount = new Intl.NumberFormat("en", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(Number(value));
  return currency ? `${amount} ${currency}` : amount;
}

function formatRate(value: number | null) {
  if (value === null) return "Not set";
  return `${new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) * 100)}%`;
}

function orderLabel(commission: Commission) {
  const order = commission.vendor_order_items?.vendor_orders;
  if (!order) return "Not available";
  return order.shopify_order_number ?? order.shopify_order_id;
}

function itemLabel(commission: Commission) {
  const item = commission.vendor_order_items;
  if (!item) return "Not available";
  return item.shopify_product_id ?? item.shopify_line_item_id;
}

function CommissionsContent({ vendor }: { vendor: VendorContext }) {
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
            "vendor_order_item_id",
            "rate",
            "amount",
            "status",
            "approved_at",
            "paid_at",
            "created_at",
            [
              "vendor_order_items(",
              "id,",
              "vendor_order_id,",
              "shopify_line_item_id,",
              "shopify_product_id,",
              "shopify_variant_id,",
              "vendor_orders(shopify_order_number,shopify_order_id,currency)",
              ")"
            ].join("")
          ].join(",")
        )
        .eq("vendor_id", vendor.vendorId)
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
  }, [vendor.vendorId]);

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
            View commission status and related order references. Commission changes are handled by
            Sinbad finance.
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
              Commission rows will appear here after order attribution is connected.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1040px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Rate</th>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Order item</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">Approved date</th>
                  <th className="px-4 py-3 font-semibold">Paid date</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredCommissions.map((commission) => {
                  const currency = commission.vendor_order_items?.vendor_orders?.currency ?? null;
                  return (
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
                        {formatMoney(commission.amount, currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatRate(commission.rate)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{orderLabel(commission)}</td>
                      <td className="px-4 py-3 text-slate-700">{itemLabel(commission)}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDate(commission.created_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDate(commission.approved_at)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDate(commission.paid_at)}
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
                  );
                })}
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
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <CommissionsContent vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
