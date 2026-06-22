"use client";

import { AuthGate } from "@/components/auth-gate";
import { AdminShell } from "@/components/admin-shell";
import { homeStats } from "@/lib/navigation";

export default function DashboardPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <section className="mb-6">
            <h1 className="text-2xl font-semibold text-ink">Home</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Admin Dashboard V1 shell is ready. Vendor Applications will be the first
              operational screen after auth and role gating are verified.
            </p>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            {homeStats.map((stat) => {
              const Icon = stat.icon;
              return (
                <article
                  key={stat.label}
                  className="rounded-lg border border-line bg-white p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-slate-500">{stat.label}</div>
                      <div className="mt-2 text-xl font-semibold text-ink">{stat.value}</div>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-ink">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        </AdminShell>
      )}
    </AuthGate>
  );
}
