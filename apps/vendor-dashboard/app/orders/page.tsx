"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { supabase } from "@/lib/supabase";

type OrderStatus = "pending" | "fulfilled" | "cancelled" | "refunded" | "partially_refunded";

type VendorOrder = {
  id: string;
  shopify_order_number: string | null;
  shopify_order_id: string;
  currency: string | null;
  subtotal: number | null;
  commission_total: number | null;
  status: OrderStatus;
  ordered_at: string | null;
  created_at: string;
};

const statusLabels: Record<OrderStatus, string> = {
  pending: "Pending",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
  refunded: "Refunded",
  partially_refunded: "Partially refunded"
};

const statusClasses: Record<OrderStatus, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  fulfilled: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  refunded: "bg-rose-50 text-rose-700 ring-rose-200",
  partially_refunded: "bg-orange-50 text-orange-800 ring-orange-200"
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

function orderNumber(order: VendorOrder) {
  return order.shopify_order_number ?? order.shopify_order_id;
}

function OrdersContent({ vendor }: { vendor: VendorContext }) {
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadOrders() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("vendor_orders")
        .select(
          "id,shopify_order_number,shopify_order_id,currency,subtotal,commission_total,status,ordered_at,created_at"
        )
        .eq("vendor_id", vendor.vendorId)
        .order("ordered_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setOrders([]);
      } else {
        setOrders((data ?? []) as VendorOrder[]);
      }

      setLoading(false);
    }

    void loadOrders();

    return () => {
      mounted = false;
    };
  }, [vendor.vendorId]);

  const orderCount = useMemo(() => orders.length, [orders]);

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Orders</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            View vendor-attributed orders and commission estimates. Order management remains handled
            by Sinbad.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">{orderCount} shown</div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-sm font-medium text-slate-600">Loading orders...</div>
        ) : error ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-rose-700">Could not load orders</h2>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-ink">No vendor orders found</h2>
            <p className="mt-2 text-sm text-slate-600">
              Vendor-attributed Shopify orders will appear here after webhook ingestion is connected.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Order number</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">Vendor subtotal</th>
                  <th className="px-4 py-3 font-semibold">Commission estimate</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      window.location.href = `/orders/${order.id}`;
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                          statusClasses[order.status]
                        ].join(" ")}
                      >
                        {statusLabels[order.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{orderNumber(order)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(order.ordered_at ?? order.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatMoney(order.subtotal, order.currency)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatMoney(order.commission_total, order.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/orders/${order.id}`}
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

export default function OrdersPage() {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <OrdersContent vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
