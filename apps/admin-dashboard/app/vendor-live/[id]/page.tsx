"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type LiveStatus = "draft" | "scheduled" | "live" | "ended" | "cancelled";

type LiveSession = {
  id: string;
  vendor_id: string;
  title: string;
  status: LiveStatus;
  starts_at: string | null;
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  vendors: {
    id: string;
    name: string;
    slug: string;
    status: string;
  } | null;
};

type PinnedProduct = {
  id: string;
  live_session_id: string;
  vendor_id: string;
  vendor_product_id: string;
  position: number;
  created_at: string;
  vendor_products: {
    id: string;
    title: string;
    status: string;
    shopify_product_id: string | null;
  } | null;
};

type VendorProduct = {
  id: string;
  title: string;
  status: string;
};

type DetailPageProps = {
  params: {
    id: string;
  };
};

const statusLabels: Record<LiveStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  ended: "Ended",
  cancelled: "Cancelled"
};

const statusClasses: Record<LiveStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  scheduled: "bg-sky-50 text-sky-700 ring-sky-200",
  live: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ended: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200"
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
      {children}
    </section>
  );
}

function VendorLiveDetail({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [pinnedProducts, setPinnedProducts] = useState<PinnedProduct[]>([]);
  const [availableProducts, setAvailableProducts] = useState<VendorProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: sessionData, error: sessionError } = await supabase
      .from("vendor_live_sessions")
      .select("id,vendor_id,title,status,starts_at,ended_at,created_by,created_at,updated_at,vendors(id,name,slug,status)")
      .eq("id", sessionId)
      .maybeSingle();

    if (sessionError) {
      setError(sessionError.message);
      setSession(null);
      setPinnedProducts([]);
      setAvailableProducts([]);
      setLoading(false);
      return;
    }

    const nextSession = sessionData as unknown as LiveSession | null;

    if (!nextSession) {
      setSession(null);
      setPinnedProducts([]);
      setAvailableProducts([]);
      setLoading(false);
      return;
    }

    const [pinsResponse, productsResponse] = await Promise.all([
      supabase
        .from("vendor_live_session_products")
        .select("id,live_session_id,vendor_id,vendor_product_id,position,created_at,vendor_products(id,title,status,shopify_product_id)")
        .eq("live_session_id", sessionId)
        .order("position", { ascending: true }),
      supabase
        .from("vendor_products")
        .select("id,title,status")
        .eq("vendor_id", nextSession.vendor_id)
        .in("status", ["approved", "published"])
        .order("title", { ascending: true })
    ]);

    const firstError = pinsResponse.error ?? productsResponse.error;
    if (firstError) {
      setError(firstError.message);
      setSession(nextSession);
      setLoading(false);
      return;
    }

    const pins = (pinsResponse.data ?? []) as unknown as PinnedProduct[];
    const products = (productsResponse.data ?? []) as unknown as VendorProduct[];

    setSession(nextSession);
    setPinnedProducts(pins);
    setAvailableProducts(products);
    setSelectedProductId((current) => current || products[0]?.id || "");
    setLoading(false);
  }, [sessionId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function handlePinProduct() {
    if (!selectedProductId) return;

    setActionLoading("Pin product");
    setError(null);
    setActionMessage(null);

    const { error: rpcError } = await supabase.rpc("pin_vendor_live_product", {
      p_live_session_id: sessionId,
      p_vendor_product_id: selectedProductId,
      p_position: null
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setActionMessage("Product pinned.");
      await loadSession();
    }

    setActionLoading(null);
  }

  async function handleUnpinProduct(productId: string) {
    const confirmed = window.confirm("Unpin this product from the live session?");
    if (!confirmed) return;

    setActionLoading("Unpin product");
    setError(null);
    setActionMessage(null);

    const { error: rpcError } = await supabase.rpc("unpin_vendor_live_product", {
      p_live_session_id: sessionId,
      p_vendor_product_id: productId
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      setActionMessage("Product unpinned.");
      await loadSession();
    }

    setActionLoading(null);
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading live session...</div>
      </section>
    );
  }

  if (error && !session) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load live session</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/vendor-live"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Vendor Live
        </Link>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Live session not found</h1>
        <Link
          href="/vendor-live"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Vendor Live
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/vendor-live"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Vendor Live
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{session.title}</h1>
          <span
            className={[
              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              statusClasses[session.status]
            ].join(" ")}
          >
            {statusLabels[session.status]}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Shared Sinbad Live session. Vendor pins are constrained to same-vendor products.
        </p>
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

      <Section title="Session Details">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Title" value={session.title} />
          <DetailField label="Status" value={statusLabels[session.status]} />
          <DetailField label="Created by" value={session.created_by} />
          <DetailField label="Starts at" value={formatDate(session.starts_at)} />
          <DetailField label="Ended at" value={formatDate(session.ended_at)} />
          <DetailField label="Created date" value={formatDate(session.created_at)} />
          <DetailField label="Updated date" value={formatDate(session.updated_at)} />
        </dl>
      </Section>

      <Section title="Vendor Details">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Vendor" value={session.vendors?.name ?? "Official Sinbad"} />
          <DetailField label="Vendor slug" value={session.vendors?.slug ?? null} />
          <DetailField label="Vendor status" value={session.vendors?.status ?? null} />
          <DetailField label="Vendor ID" value={session.vendor_id} />
        </dl>
      </Section>

      <Section title="Pinned Products">
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <select
            className="h-10 min-w-0 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-ink md:w-96"
            value={selectedProductId}
            onChange={(event) => setSelectedProductId(event.target.value)}
          >
            {availableProducts.length === 0 ? (
              <option value="">No approved products available</option>
            ) : (
              availableProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} ({product.status})
                </option>
              ))
            )}
          </select>
          <button
            className="h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!selectedProductId || Boolean(actionLoading)}
            onClick={() => void handlePinProduct()}
          >
            Pin Product
          </button>
        </div>

        {pinnedProducts.length === 0 ? (
          <p className="mt-5 text-sm text-slate-600">No products are pinned to this session.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-[760px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Position</th>
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Shopify product ID</th>
                  <th className="px-4 py-3 font-semibold">Pinned date</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pinnedProducts.map((pin) => (
                  <tr key={pin.id}>
                    <td className="px-4 py-3 text-slate-700">{pin.position}</td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {pin.vendor_products?.title ?? "Unknown product"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {pin.vendor_products?.status ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {pin.vendor_products?.shopify_product_id ?? "Not published"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(pin.created_at)}</td>
                    <td className="px-4 py-3">
                      <button
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                        disabled={Boolean(actionLoading)}
                        onClick={() => void handleUnpinProduct(pin.vendor_product_id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Unpin
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

export default function VendorLiveDetailPage({ params }: DetailPageProps) {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <VendorLiveDetail sessionId={params.id} />
        </AdminShell>
      )}
    </AuthGate>
  );
}
