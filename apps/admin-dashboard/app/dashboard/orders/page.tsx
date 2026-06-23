"use client";

import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";

export default function OrdersPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-semibold text-ink">Orders</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Read-only V1 order management will show Shopify-attributed vendor orders after order
              webhook attribution is connected.
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
