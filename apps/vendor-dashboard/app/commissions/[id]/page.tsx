"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import type { VendorContext } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { supabase } from "@/lib/supabase";

type CommissionStatus = "pending" | "approved" | "paid" | "void";

type Commission = {
  id: string;
  vendor_id: string;
  vendor_order_item_id: string;
  rate: number;
  amount: number;
  status: CommissionStatus;
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  vendor_order_items: {
    id: string;
    vendor_order_id: string;
    shopify_line_item_id: string;
    shopify_product_id: string | null;
    shopify_variant_id: string | null;
    quantity: number;
    unit_price: number;
    line_subtotal: number;
    commission_rate: number | null;
    commission_amount: number | null;
    vendor_orders: {
      shopify_order_number: string | null;
      shopify_order_id: string;
      currency: string | null;
      ordered_at: string | null;
    } | null;
  } | null;
};

type DetailPageProps = {
  params: {
    id: string;
  };
};

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

function fieldValue(value: string | number | null) {
  if (value === null || value === "") return "Not provided";
  return String(value);
}

function orderLabel(commission: Commission) {
  const order = commission.vendor_order_items?.vendor_orders;
  if (!order) return "Not available";
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

function CommissionDetail({ commissionId, vendor }: { commissionId: string; vendor: VendorContext }) {
  const [commission, setCommission] = useState<Commission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCommission = useCallback(async () => {
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
          "approved_by",
          "approved_at",
          "paid_at",
          "created_at",
          "updated_at",
          [
            "vendor_order_items(",
            "id,",
            "vendor_order_id,",
            "shopify_line_item_id,",
            "shopify_product_id,",
            "shopify_variant_id,",
            "quantity,",
            "unit_price,",
            "line_subtotal,",
            "commission_rate,",
            "commission_amount,",
            "vendor_orders(shopify_order_number,shopify_order_id,currency,ordered_at)",
            ")"
          ].join("")
        ].join(",")
      )
      .eq("id", commissionId)
      .eq("vendor_id", vendor.vendorId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      setCommission(null);
    } else {
      setCommission(data as unknown as Commission | null);
    }

    setLoading(false);
  }, [commissionId, vendor.vendorId]);

  useEffect(() => {
    void loadCommission();
  }, [loadCommission]);

  const timeline = useMemo(() => {
    if (!commission) return [];
    return [
      { label: "Created", value: commission.created_at, active: true },
      { label: "Approved", value: commission.approved_at, active: Boolean(commission.approved_at) },
      { label: "Paid", value: commission.paid_at, active: Boolean(commission.paid_at) },
      {
        label: "Current status",
        value: statusLabels[commission.status],
        active: true
      }
    ];
  }, [commission]);

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading commission...</div>
      </section>
    );
  }

  if (error && !commission) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load commission</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/commissions"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Commissions
        </Link>
      </section>
    );
  }

  if (!commission) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Commission not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          This commission is not available for the selected vendor.
        </p>
        <Link
          href="/commissions"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Commissions
        </Link>
      </section>
    );
  }

  const orderItem = commission.vendor_order_items;
  const currency = orderItem?.vendor_orders?.currency ?? null;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/commissions"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Commissions
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">Commission</h1>
          <span
            className={[
              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              statusClasses[commission.status]
            ].join(" ")}
          >
            {statusLabels[commission.status]}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Commission status is read-only in the Vendor Dashboard.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <Section title="Commission Details">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Commission ID" value={commission.id} />
          <DetailField label="Status" value={statusLabels[commission.status]} />
          <DetailField label="Amount" value={formatMoney(commission.amount, currency)} />
          <DetailField label="Rate" value={formatRate(commission.rate)} />
          <DetailField label="Created date" value={formatDate(commission.created_at)} />
          <DetailField label="Updated date" value={formatDate(commission.updated_at)} />
          <DetailField label="Approved date" value={formatDate(commission.approved_at)} />
          <DetailField label="Paid date" value={formatDate(commission.paid_at)} />
          <DetailField label="Approved by" value={commission.approved_by} />
        </dl>
      </Section>

      <Section title="Order Item Reference">
        {orderItem ? (
          <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DetailField label="Order" value={orderLabel(commission)} />
            <DetailField label="Order item ID" value={orderItem.id} />
            <DetailField label="Shopify line item ID" value={orderItem.shopify_line_item_id} />
            <DetailField label="Shopify product ID" value={orderItem.shopify_product_id} />
            <DetailField label="Shopify variant ID" value={orderItem.shopify_variant_id} />
            <DetailField label="Quantity" value={orderItem.quantity} />
            <DetailField label="Unit price" value={formatMoney(orderItem.unit_price, currency)} />
            <DetailField
              label="Line subtotal"
              value={formatMoney(orderItem.line_subtotal, currency)}
            />
            <DetailField
              label="Item commission rate"
              value={formatRate(orderItem.commission_rate)}
            />
            <DetailField
              label="Item commission amount"
              value={formatMoney(orderItem.commission_amount, currency)}
            />
            <DetailField
              label="Order date"
              value={formatDate(orderItem.vendor_orders?.ordered_at ?? null)}
            />
          </dl>
        ) : (
          <p className="mt-4 text-sm text-slate-600">Order item details are not available.</p>
        )}
      </Section>

      <Section title="Status Timeline">
        <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {timeline.map((item) => (
            <li
              key={item.label}
              className={[
                "rounded-md border px-3 py-3",
                item.active ? "border-line bg-slate-50" : "border-line bg-white opacity-60"
              ].join(" ")}
            >
              <div className="text-xs font-semibold uppercase text-slate-500">{item.label}</div>
              <div className="mt-1 text-sm font-medium text-ink">
                {item.label === "Current status" ? item.value : formatDate(item.value)}
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

export default function CommissionDetailPage({ params }: DetailPageProps) {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <CommissionDetail commissionId={params.id} vendor={vendor} />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
