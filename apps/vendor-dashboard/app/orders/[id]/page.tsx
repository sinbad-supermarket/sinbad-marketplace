"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { supabase } from "@/lib/supabase";

type OrderStatus = "pending" | "fulfilled" | "cancelled" | "refunded" | "partially_refunded";

type CommissionStatus = "pending" | "approved" | "paid" | "void";

type VendorOrder = {
  id: string;
  vendor_id: string;
  shopify_order_id: string;
  shopify_order_number: string | null;
  customer_email_signal: string | null;
  currency: string | null;
  subtotal: number | null;
  commission_total: number | null;
  status: OrderStatus;
  ordered_at: string | null;
  created_at: string;
  updated_at: string;
};

type VendorOrderItem = {
  id: string;
  vendor_order_id: string;
  vendor_product_id: string | null;
  shopify_line_item_id: string;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  quantity: number;
  unit_price: number;
  line_subtotal: number;
  commission_rate: number | null;
  commission_amount: number | null;
  created_at: string;
};

type VendorCommission = {
  id: string;
  vendor_order_item_id: string;
  rate: number;
  amount: number;
  status: CommissionStatus;
  approved_at: string | null;
  paid_at: string | null;
};

type DetailPageProps = {
  params: {
    id: string;
  };
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

const commissionStatusLabels: Record<CommissionStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  paid: "Paid",
  void: "Void"
};

const commissionStatusClasses: Record<CommissionStatus, string> = {
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

function fieldValue(value: string | number | null) {
  if (value === null || value === "") return "Not provided";
  return String(value);
}

function orderNumber(order: VendorOrder) {
  return order.shopify_order_number ?? order.shopify_order_id;
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

function OrderDetail({ orderId, vendor }: { orderId: string; vendor: VendorContext }) {
  const [order, setOrder] = useState<VendorOrder | null>(null);
  const [items, setItems] = useState<VendorOrderItem[]>([]);
  const [commissions, setCommissions] = useState<Record<string, VendorCommission>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: orderData, error: orderError } = await supabase
      .from("vendor_orders")
      .select("*")
      .eq("id", orderId)
      .eq("vendor_id", vendor.vendorId)
      .maybeSingle();

    if (orderError) {
      setError(orderError.message);
      setOrder(null);
      setItems([]);
      setCommissions({});
      setLoading(false);
      return;
    }

    const loadedOrder = orderData as VendorOrder | null;
    setOrder(loadedOrder);

    if (!loadedOrder) {
      setItems([]);
      setCommissions({});
      setLoading(false);
      return;
    }

    const { data: itemData, error: itemError } = await supabase
      .from("vendor_order_items")
      .select(
        "id,vendor_order_id,vendor_product_id,shopify_line_item_id,shopify_product_id,shopify_variant_id,quantity,unit_price,line_subtotal,commission_rate,commission_amount,created_at"
      )
      .eq("vendor_order_id", loadedOrder.id)
      .eq("vendor_id", vendor.vendorId)
      .order("created_at", { ascending: true });

    if (itemError) {
      setError(itemError.message);
      setItems([]);
      setCommissions({});
      setLoading(false);
      return;
    }

    const loadedItems = (itemData ?? []) as VendorOrderItem[];
    setItems(loadedItems);

    if (loadedItems.length === 0) {
      setCommissions({});
      setLoading(false);
      return;
    }

    const { data: commissionData, error: commissionError } = await supabase
      .from("vendor_commissions")
      .select("id,vendor_order_item_id,rate,amount,status,approved_at,paid_at")
      .eq("vendor_id", vendor.vendorId)
      .in(
        "vendor_order_item_id",
        loadedItems.map((item) => item.id)
      );

    if (commissionError) {
      setError(commissionError.message);
      setCommissions({});
    } else {
      const commissionMap = Object.fromEntries(
        ((commissionData ?? []) as VendorCommission[]).map((commission) => [
          commission.vendor_order_item_id,
          commission
        ])
      );
      setCommissions(commissionMap);
    }

    setLoading(false);
  }, [orderId, vendor.vendorId]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const itemTotals = useMemo(
    () => ({
      subtotal: items.reduce((total, item) => total + Number(item.line_subtotal), 0),
      commission: items.reduce(
        (total, item) =>
          total +
          Number(commissions[item.id]?.amount ?? item.commission_amount ?? 0),
        0
      )
    }),
    [commissions, items]
  );

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading order...</div>
      </section>
    );
  }

  if (error && !order) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load order</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/orders"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Orders
        </Link>
      </section>
    );
  }

  if (!order) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Order not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          This order is not available for the selected vendor.
        </p>
        <Link
          href="/orders"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Orders
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/orders"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">Order {orderNumber(order)}</h1>
          <span
            className={[
              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              statusClasses[order.status]
            ].join(" ")}
          >
            {statusLabels[order.status]}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Vendor line items only. Order changes are handled by Sinbad.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <Section title="Order Summary">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Order number" value={order.shopify_order_number} />
          <DetailField label="Shopify order ID" value={order.shopify_order_id} />
          <DetailField label="Status" value={statusLabels[order.status]} />
          <DetailField label="Ordered date" value={formatDate(order.ordered_at)} />
          <DetailField label="Created date" value={formatDate(order.created_at)} />
          <DetailField label="Updated date" value={formatDate(order.updated_at)} />
          <DetailField label="Customer email signal" value={order.customer_email_signal} />
          <DetailField label="Vendor subtotal" value={formatMoney(order.subtotal, order.currency)} />
          <DetailField
            label="Commission estimate"
            value={formatMoney(order.commission_total, order.currency)}
          />
        </dl>
      </Section>

      <Section title="Line Items">
        {items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No vendor line items found for this order.</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left text-sm">
                <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Line item ID</th>
                    <th className="px-4 py-3 font-semibold">Quantity</th>
                    <th className="px-4 py-3 font-semibold">Unit price</th>
                    <th className="px-4 py-3 font-semibold">Line subtotal</th>
                    <th className="px-4 py-3 font-semibold">Commission rate</th>
                    <th className="px-4 py-3 font-semibold">Commission amount</th>
                    <th className="px-4 py-3 font-semibold">Commission status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {items.map((item) => {
                    const commission = commissions[item.id];
                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-3 font-medium text-ink">
                          {item.shopify_line_item_id}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{item.quantity}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatMoney(item.unit_price, order.currency)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatMoney(item.line_subtotal, order.currency)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatRate(commission?.rate ?? item.commission_rate)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {formatMoney(
                            commission?.amount ?? item.commission_amount,
                            order.currency
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {commission ? (
                            <span
                              className={[
                                "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                                commissionStatusClasses[commission.status]
                              ].join(" ")}
                            >
                              {commissionStatusLabels[commission.status]}
                            </span>
                          ) : (
                            <span className="text-slate-500">Not available</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <dl className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <DetailField
                label="Line item subtotal"
                value={formatMoney(itemTotals.subtotal, order.currency)}
              />
              <DetailField
                label="Line item commission"
                value={formatMoney(itemTotals.commission, order.currency)}
              />
            </dl>
          </>
        )}
      </Section>
    </div>
  );
}

export default function OrderDetailPage({ params }: DetailPageProps) {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <OrderDetail orderId={params.id} vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
