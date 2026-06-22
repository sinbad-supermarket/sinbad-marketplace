"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type ApplicationStatus = "new" | "under_review" | "needs_changes" | "approved" | "rejected";

type VendorApplication = {
  id: string;
  status: ApplicationStatus;
  company_trade_name: string;
  company_legal_name: string;
  owner_full_name: string;
  owner_email: string;
  owner_phone: string;
  business_category: string;
  city_area: string;
  created_at: string;
  reviewed_at: string | null;
};

const filters: Array<{ label: string; value: "all" | ApplicationStatus }> = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Under review", value: "under_review" },
  { label: "Needs changes", value: "needs_changes" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" }
];

const statusLabels: Record<ApplicationStatus, string> = {
  new: "New",
  under_review: "Under review",
  needs_changes: "Needs changes",
  approved: "Approved",
  rejected: "Rejected"
};

const statusClasses: Record<ApplicationStatus, string> = {
  new: "bg-sky-50 text-sky-700 ring-sky-200",
  under_review: "bg-amber-50 text-amber-800 ring-amber-200",
  needs_changes: "bg-orange-50 text-orange-800 ring-orange-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rejected: "bg-rose-50 text-rose-700 ring-rose-200"
};

function formatDate(value: string | null) {
  if (!value) return "Not reviewed";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function ApplicationsContent() {
  const [applications, setApplications] = useState<VendorApplication[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | ApplicationStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadApplications() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("vendor_applications")
        .select(
          [
            "id",
            "status",
            "company_trade_name",
            "company_legal_name",
            "owner_full_name",
            "owner_email",
            "owner_phone",
            "business_category",
            "city_area",
            "created_at",
            "reviewed_at"
          ].join(",")
        )
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setApplications([]);
      } else {
        setApplications((data ?? []) as unknown as VendorApplication[]);
      }

      setLoading(false);
    }

    void loadApplications();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredApplications = useMemo(() => {
    if (activeFilter === "all") return applications;
    return applications.filter((application) => application.status === activeFilter);
  }, [activeFilter, applications]);

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Vendor Applications</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Review vendor onboarding applications before creating vendor dashboard access.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">
          {filteredApplications.length} shown
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
          <div className="p-8 text-sm font-medium text-slate-600">
            Loading vendor applications...
          </div>
        ) : error ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-rose-700">Could not load applications</h2>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        ) : filteredApplications.length === 0 ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-ink">No applications found</h2>
            <p className="mt-2 text-sm text-slate-600">
              New vendor applications will appear here after submission.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Trade name</th>
                  <th className="px-4 py-3 font-semibold">Legal name</th>
                  <th className="px-4 py-3 font-semibold">Owner name</th>
                  <th className="px-4 py-3 font-semibold">Owner email</th>
                  <th className="px-4 py-3 font-semibold">Owner phone</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">City/Area</th>
                  <th className="px-4 py-3 font-semibold">Submitted date</th>
                  <th className="px-4 py-3 font-semibold">Reviewed date</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredApplications.map((application) => (
                  <tr
                    key={application.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      window.location.href = `/applications/${application.id}`;
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                          statusClasses[application.status]
                        ].join(" ")}
                      >
                        {statusLabels[application.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {application.company_trade_name}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {application.company_legal_name}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{application.owner_full_name}</td>
                    <td className="px-4 py-3 text-slate-700">{application.owner_email}</td>
                    <td className="px-4 py-3 text-slate-700">{application.owner_phone}</td>
                    <td className="px-4 py-3 text-slate-700">{application.business_category}</td>
                    <td className="px-4 py-3 text-slate-700">{application.city_area}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(application.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {formatDate(application.reviewed_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/applications/${application.id}`}
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

export default function ApplicationsPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <ApplicationsContent />
        </AdminShell>
      )}
    </AuthGate>
  );
}
