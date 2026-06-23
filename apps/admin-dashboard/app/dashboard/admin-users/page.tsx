"use client";

import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";

export default function AdminUsersPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold text-ink">Admin Users</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Admin user management will list Sinbad owner, admin, reviewer, and finance access in
              a controlled read-only V1 view before role editing is enabled.
            </p>
            <div className="mt-5 rounded-md border border-dashed border-line bg-slate-50 px-4 py-6 text-sm font-medium text-slate-600">
              Coming soon / Read-only V1
            </div>
          </section>
        </AdminShell>
      )}
    </AuthGate>
  );
}
