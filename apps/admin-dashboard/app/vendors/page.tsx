"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
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
  created_at: string;
  updated_at: string;
};

const filters: Array<{ label: string; value: "all" | VendorStatus }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Active", value: "active" },
  { label: "Suspended", value: "suspended" },
  { label: "Archived", value: "archived" }
];

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

function VendorsContent() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | VendorStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadVendors() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("vendors")
        .select("id,name,slug,status,default_commission_rate,created_at,updated_at")
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setVendors([]);
      } else {
        setVendors((data ?? []) as unknown as Vendor[]);
      }

      setLoading(false);
    }

    void loadVendors();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredVendors = useMemo(() => {
    if (activeFilter === "all") return vendors;
    return vendors.filter((vendor) => vendor.status === activeFilter);
  }, [activeFilter, vendors]);

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Vendors</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            View approved vendor accounts and operational status.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">{filteredVendors.length} shown</div>
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
          <div className="p-8 text-sm font-medium text-slate-600">Loading vendors...</div>
        ) : error ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-rose-700">Could not load vendors</h2>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-ink">No vendors found</h2>
            <p className="mt-2 text-sm text-slate-600">
              Approved vendor applications will create vendor accounts here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[920px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Slug</th>
                  <th className="px-4 py-3 font-semibold">Default commission rate</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">Updated date</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredVendors.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      window.location.href = `/vendors/${vendor.id}`;
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                          statusClasses[vendor.status]
                        ].join(" ")}
                      >
                        {statusLabels[vendor.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{vendor.name}</td>
                    <td className="px-4 py-3 text-slate-700">{vendor.slug}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatRate(vendor.default_commission_rate)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(vendor.created_at)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(vendor.updated_at)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/vendors/${vendor.id}`}
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

export default function VendorsPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <VendorsContent />
        </AdminShell>
      )}
    </AuthGate>
  );
}
