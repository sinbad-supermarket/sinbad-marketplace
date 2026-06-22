"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
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
  vendors: {
    name: string;
    slug: string;
  } | null;
};

const filters: Array<{ label: string; value: "all" | LiveStatus }> = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Live", value: "live" },
  { label: "Ended", value: "ended" },
  { label: "Cancelled", value: "cancelled" }
];

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

function VendorLiveContent() {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [activeFilter, setActiveFilter] = useState<"all" | LiveStatus>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadSessions() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("vendor_live_sessions")
        .select("id,vendor_id,title,status,starts_at,ended_at,created_by,created_at,vendors(name,slug)")
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setSessions([]);
      } else {
        setSessions((data ?? []) as unknown as LiveSession[]);
      }

      setLoading(false);
    }

    void loadSessions();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredSessions = useMemo(() => {
    if (activeFilter === "all") return sessions;
    return sessions.filter((session) => session.status === activeFilter);
  }, [activeFilter, sessions]);

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Vendor Live</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Monitor live sessions and pinned products across the shared Sinbad Live system.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">{filteredSessions.length} shown</div>
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
          <div className="p-8 text-sm font-medium text-slate-600">Loading live sessions...</div>
        ) : error ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-rose-700">Could not load live sessions</h2>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-ink">No live sessions found</h2>
            <p className="mt-2 text-sm text-slate-600">
              Vendor live sessions will appear here when vendors create them.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1040px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Starts at</th>
                  <th className="px-4 py-3 font-semibold">Ended at</th>
                  <th className="px-4 py-3 font-semibold">Created by</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredSessions.map((session) => (
                  <tr
                    key={session.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => {
                      window.location.href = `/vendor-live/${session.id}`;
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className={[
                          "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                          statusClasses[session.status]
                        ].join(" ")}
                      >
                        {statusLabels[session.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">{session.title}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {session.vendors?.name ?? "Official Sinbad"}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(session.starts_at)}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(session.ended_at)}</td>
                    <td className="px-4 py-3 text-slate-700">{session.created_by ?? "Not set"}</td>
                    <td className="px-4 py-3 text-slate-700">{formatDate(session.created_at)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/vendor-live/${session.id}`}
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

export default function VendorLivePage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <VendorLiveContent />
        </AdminShell>
      )}
    </AuthGate>
  );
}
