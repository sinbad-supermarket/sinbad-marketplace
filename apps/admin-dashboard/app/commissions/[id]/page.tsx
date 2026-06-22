"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
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
  approved_by: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  vendors: {
    name: string;
    slug: string;
  } | null;
  vendor_order_items: {
    id: string;
    shopify_line_item_id: string;
    shopify_product_id: string | null;
    shopify_variant_id: string | null;
    quantity: number;
    unit_price: number;
    line_subtotal: number;
    commission_rate: number | null;
    commission_amount: number | null;
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

function fieldValue(value: string | number | null) {
  if (value === null || value === "") return "Not provided";
  return String(value);
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
      <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</dl>
    </section>
  );
}

function CommissionDetail({ commissionId }: { commissionId: string }) {
  const [commission, setCommission] = useState<Commission | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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
          "vendors(name,slug)",
          [
            "vendor_order_items(",
            "id,",
            "shopify_line_item_id,",
            "shopify_product_id,",
            "shopify_variant_id,",
            "quantity,",
            "unit_price,",
            "line_subtotal,",
            "commission_rate,",
            "commission_amount",
            ")"
          ].join("")
        ].join(",")
      )
      .eq("id", commissionId)
      .maybeSingle();

    if (loadError) {
      setError(loadError.message);
      setCommission(null);
    } else {
      setCommission(data as unknown as Commission | null);
    }

    setLoading(false);
  }, [commissionId]);

  useEffect(() => {
    void loadCommission();
  }, [loadCommission]);

  async function runAction(
    label: string,
    rpcName: "approve_commission" | "mark_commission_paid" | "void_commission",
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
      await loadCommission();
    }

    setActionLoading(null);
  }

  function handleApprove() {
    const confirmed = window.confirm("Approve this commission?");
    if (!confirmed) return;
    const notes = window.prompt("Optional approval notes:");

    void runAction("Approve", "approve_commission", {
      commission_id: commissionId,
      notes: notes?.trim() || null
    });
  }

  function handleMarkPaid() {
    const confirmed = window.confirm("Mark this commission as paid?");
    if (!confirmed) return;
    const notes = window.prompt("Optional payment notes:");

    void runAction("Mark paid", "mark_commission_paid", {
      commission_id: commissionId,
      notes: notes?.trim() || null
    });
  }

  function handleVoid() {
    const reason = window.prompt("Enter the void reason:");
    if (!reason || reason.trim().length === 0) return;

    const confirmed = window.confirm("Void this commission?");
    if (!confirmed) return;

    void runAction("Void", "void_commission", {
      commission_id: commissionId,
      reason: reason.trim()
    });
  }

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
        <Link
          href="/commissions"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Commissions
        </Link>
      </section>
    );
  }

  const canApprove = commission.status === "pending";
  const canMarkPaid = commission.status === "approved";
  const canVoid = commission.status === "pending" || commission.status === "approved";
  const orderItem = commission.vendor_order_items;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
            Created {formatDate(commission.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canApprove ? (
            <button
              className="h-9 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              disabled={Boolean(actionLoading)}
              onClick={handleApprove}
            >
              Approve
            </button>
          ) : null}
          {canMarkPaid ? (
            <button
              className="h-9 rounded-md bg-indigo-700 px-3 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-60"
              disabled={Boolean(actionLoading)}
              onClick={handleMarkPaid}
            >
              Mark paid
            </button>
          ) : null}
          {canVoid ? (
            <button
              className="h-9 rounded-md bg-rose-700 px-3 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
              disabled={Boolean(actionLoading)}
              onClick={handleVoid}
            >
              Void
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

      <Section title="Commission">
        <DetailField label="Vendor" value={commission.vendors?.name ?? null} />
        <DetailField label="Rate" value={formatRate(commission.rate)} />
        <DetailField label="Amount" value={formatMoney(commission.amount)} />
        <DetailField label="Status" value={statusLabels[commission.status]} />
        <DetailField label="Approved by" value={commission.approved_by} />
        <DetailField label="Approved date" value={formatDate(commission.approved_at)} />
        <DetailField label="Paid date" value={formatDate(commission.paid_at)} />
        <DetailField label="Created date" value={formatDate(commission.created_at)} />
        <DetailField label="Updated date" value={formatDate(commission.updated_at)} />
      </Section>

      <Section title="Order Item">
        <DetailField label="Order item ID" value={orderItem?.id ?? null} />
        <DetailField label="Shopify line item ID" value={orderItem?.shopify_line_item_id ?? null} />
        <DetailField label="Shopify product ID" value={orderItem?.shopify_product_id ?? null} />
        <DetailField label="Shopify variant ID" value={orderItem?.shopify_variant_id ?? null} />
        <DetailField label="Quantity" value={orderItem?.quantity ?? null} />
        <DetailField label="Unit price" value={formatMoney(orderItem?.unit_price ?? null)} />
        <DetailField label="Line subtotal" value={formatMoney(orderItem?.line_subtotal ?? null)} />
        <DetailField
          label="Line commission rate"
          value={formatRate(orderItem?.commission_rate ?? null)}
        />
        <DetailField
          label="Line commission amount"
          value={formatMoney(orderItem?.commission_amount ?? null)}
        />
      </Section>
    </div>
  );
}

export default function CommissionDetailPage({ params }: DetailPageProps) {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <CommissionDetail commissionId={params.id} />
        </AdminShell>
      )}
    </AuthGate>
  );
}
