"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type VendorStatus = "draft" | "active" | "suspended" | "archived";

type Vendor = {
  id: string;
  name: string;
  slug: string;
  status: VendorStatus;
  default_commission_rate: number;
  shopify_collection_id: string | null;
  created_at: string;
  updated_at: string;
};

type VendorUser = {
  id: string;
  user_id: string;
  role: "owner" | "staff";
  status: "active" | "invited" | "suspended";
  created_at: string;
};

type CommissionRow = {
  status: "pending" | "approved" | "paid" | "void";
  amount: number;
};

type DetailPageProps = {
  params: {
    id: string;
  };
};

type VendorStats = {
  submissions: number;
  products: number;
  orders: number;
  liveSessions: number;
  commissions: {
    count: number;
    total: number;
    pending: number;
    approved: number;
    paid: number;
    void: number;
  };
};

const statusLabels: Record<VendorStatus, string> = {
  draft: "Draft",
  active: "Active",
  suspended: "Suspended",
  archived: "Archived"
};

const statusClasses: Record<VendorStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  suspended: "bg-amber-50 text-amber-800 ring-amber-200",
  archived: "bg-rose-50 text-rose-700 ring-rose-200"
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

function formatRate(value: number | null) {
  if (value === null) return "Not set";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(value);
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
      {children}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-sm">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
    </article>
  );
}

function VendorDetail({ vendorId }: { vendorId: string }) {
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [vendorUsers, setVendorUsers] = useState<VendorUser[]>([]);
  const [stats, setStats] = useState<VendorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadVendor = useCallback(async () => {
    setLoading(true);
    setError(null);

    const vendorRequest = supabase
      .from("vendors")
      .select("id,name,slug,status,default_commission_rate,shopify_collection_id,created_at,updated_at")
      .eq("id", vendorId)
      .maybeSingle();

    const vendorUsersRequest = supabase
      .from("vendor_users")
      .select("id,user_id,role,status,created_at")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: true });

    const submissionsCountRequest = supabase
      .from("vendor_product_submissions")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId);

    const productsCountRequest = supabase
      .from("vendor_products")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId);

    const ordersCountRequest = supabase
      .from("vendor_orders")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId);

    const liveCountRequest = supabase
      .from("vendor_live_sessions")
      .select("id", { count: "exact", head: true })
      .eq("vendor_id", vendorId);

    const commissionsRequest = supabase
      .from("vendor_commissions")
      .select("status,amount")
      .eq("vendor_id", vendorId);

    const [
      vendorResponse,
      vendorUsersResponse,
      submissionsResponse,
      productsResponse,
      ordersResponse,
      liveResponse,
      commissionsResponse
    ] = await Promise.all([
      vendorRequest,
      vendorUsersRequest,
      submissionsCountRequest,
      productsCountRequest,
      ordersCountRequest,
      liveCountRequest,
      commissionsRequest
    ]);

    if (vendorResponse.error) {
      setError(vendorResponse.error.message);
      setVendor(null);
      setVendorUsers([]);
      setStats(null);
      setLoading(false);
      return;
    }

    if (!vendorResponse.data) {
      setVendor(null);
      setVendorUsers([]);
      setStats(null);
      setLoading(false);
      return;
    }

    const firstError =
      vendorUsersResponse.error ??
      submissionsResponse.error ??
      productsResponse.error ??
      ordersResponse.error ??
      liveResponse.error ??
      commissionsResponse.error;

    if (firstError) {
      setError(firstError.message);
      setVendor(vendorResponse.data as unknown as Vendor);
      setLoading(false);
      return;
    }

    const commissionRows = (commissionsResponse.data ?? []) as unknown as CommissionRow[];
    const commissionStats = commissionRows.reduce(
      (acc, row) => {
        acc.count += 1;
        acc.total += Number(row.amount ?? 0);
        acc[row.status] += 1;
        return acc;
      },
      { count: 0, total: 0, pending: 0, approved: 0, paid: 0, void: 0 }
    );

    setVendor(vendorResponse.data as unknown as Vendor);
    setVendorUsers((vendorUsersResponse.data ?? []) as unknown as VendorUser[]);
    setStats({
      submissions: submissionsResponse.count ?? 0,
      products: productsResponse.count ?? 0,
      orders: ordersResponse.count ?? 0,
      liveSessions: liveResponse.count ?? 0,
      commissions: commissionStats
    });
    setLoading(false);
  }, [vendorId]);

  useEffect(() => {
    void loadVendor();
  }, [loadVendor]);

  if (loading) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-600">Loading vendor...</div>
      </section>
    );
  }

  if (error && !vendor) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-rose-700">Could not load vendor</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
        <Link
          href="/vendors"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Vendors
        </Link>
      </section>
    );
  }

  if (!vendor) {
    return (
      <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Vendor not found</h1>
        <Link
          href="/vendors"
          className="mt-6 inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white"
        >
          Back to Vendors
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/vendors"
          className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Vendors
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{vendor.name}</h1>
          <span
            className={[
              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
              statusClasses[vendor.status]
            ].join(" ")}
          >
            {statusLabels[vendor.status]}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-600">Vendor profile and linked operations.</p>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Product submissions" value={stats?.submissions ?? 0} />
        <StatCard label="Products" value={stats?.products ?? 0} />
        <StatCard label="Orders" value={stats?.orders ?? 0} />
        <StatCard label="Live sessions" value={stats?.liveSessions ?? 0} />
        <StatCard label="Commissions total" value={formatMoney(stats?.commissions.total ?? 0)} />
      </section>

      <Section title="Vendor Profile">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailField label="Name" value={vendor.name} />
          <DetailField label="Slug" value={vendor.slug} />
          <DetailField label="Status" value={statusLabels[vendor.status]} />
          <DetailField label="Default commission rate" value={formatRate(vendor.default_commission_rate)} />
          <DetailField label="Shopify collection ID" value={vendor.shopify_collection_id} />
          <DetailField label="Created date" value={formatDate(vendor.created_at)} />
          <DetailField label="Updated date" value={formatDate(vendor.updated_at)} />
        </dl>
      </Section>

      <Section title="Vendor Users">
        {vendorUsers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No linked vendor users found.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[720px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">User ID</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {vendorUsers.map((vendorUser) => (
                  <tr key={vendorUser.id}>
                    <td className="px-4 py-3 font-medium capitalize text-ink">{vendorUser.role}</td>
                    <td className="px-4 py-3 capitalize text-slate-700">{vendorUser.status}</td>
                    <td className="px-4 py-3 text-slate-700">{vendorUser.user_id}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(vendorUser.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Commission Summary">
        <dl className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <DetailField label="Rows" value={stats?.commissions.count ?? 0} />
          <DetailField label="Pending" value={stats?.commissions.pending ?? 0} />
          <DetailField label="Approved" value={stats?.commissions.approved ?? 0} />
          <DetailField label="Paid" value={stats?.commissions.paid ?? 0} />
          <DetailField label="Void" value={stats?.commissions.void ?? 0} />
        </dl>
      </Section>
    </div>
  );
}

export default function VendorDetailPage({ params }: DetailPageProps) {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <VendorDetail vendorId={params.id} />
        </AdminShell>
      )}
    </AuthGate>
  );
}
