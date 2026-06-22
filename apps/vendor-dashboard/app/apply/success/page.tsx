import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export default function ApplySuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-6 py-8">
      <section className="w-full max-w-lg rounded-lg border border-line bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-6 w-6 text-emerald-700" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold text-ink">Application received</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Thank you for applying to sell on Sinbad. The Sinbad team will review your application
          manually. Vendor Dashboard access is granted only after approval.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Vendor Login
          </Link>
          <Link
            href="/apply"
            className="inline-flex h-9 items-center rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Submit Another
          </Link>
        </div>
      </section>
    </main>
  );
}
