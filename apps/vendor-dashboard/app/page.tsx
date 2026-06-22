import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  CircleDollarSign,
  ClipboardCheck,
  Radio,
  Truck
} from "lucide-react";

const heroImage =
  "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1800&q=80";

const highlights = [
  {
    title: "Reviewed marketplace access",
    description: "Apply once, complete the required business documents, and wait for Sinbad approval.",
    icon: ClipboardCheck
  },
  {
    title: "Product approval workflow",
    description: "Submit products for review before anything moves toward Shopify draft publishing.",
    icon: BadgeCheck
  },
  {
    title: "Sinbad-managed delivery",
    description: "Delivery stays centralized with Sinbad in V1, keeping operations consistent for customers.",
    icon: Truck
  }
] as const;

const capabilities = [
  { label: "Product submissions", icon: Boxes },
  { label: "Commission reporting", icon: CircleDollarSign },
  { label: "Vendor live readiness", icon: Radio }
] as const;

export default function VendorLandingPage() {
  return (
    <main className="min-h-screen bg-white text-ink">
      <section className="relative isolate min-h-[92vh] overflow-hidden bg-ink text-white">
        <div
          className="absolute inset-0 -z-20 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroImage})` }}
        />
        <div className="absolute inset-0 -z-10 bg-[rgba(13,22,28,0.76)]" />

        <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
          <Link href="/" className="text-lg font-semibold tracking-wide">
            Sinbad Marketplace
          </Link>
          <nav className="flex items-center gap-3 text-sm font-semibold">
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-white/80 transition hover:text-white"
            >
              Vendor Login
            </Link>
            <Link
              href="/apply"
              className="rounded-md bg-white px-4 py-2 text-ink transition hover:bg-slate-100"
            >
              Apply
            </Link>
          </nav>
        </header>

        <div className="mx-auto flex w-full max-w-7xl flex-col px-6 pb-16 pt-16 lg:px-8 lg:pb-20 lg:pt-24">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">
              Vendor Partner Program
            </p>
            <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-tight text-white md:text-7xl">
              Sell through Sinbad with a reviewed marketplace workflow.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/78">
              Join Sinbad Marketplace to submit products, track approvals, monitor commissions,
              and prepare your catalog for Sinbad-managed commerce operations.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/apply"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-white px-6 text-sm font-semibold text-ink transition hover:bg-slate-100"
              >
                Apply as a Vendor
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center rounded-md border border-white/28 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-7xl gap-5 px-6 py-10 lg:grid-cols-3 lg:px-8">
          {highlights.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="rounded-lg border border-line bg-white p-5">
                <Icon className="h-5 w-5 text-ink" aria-hidden="true" />
                <h2 className="mt-4 text-base font-semibold text-ink">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="bg-panel">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-16 lg:grid-cols-[1fr_0.9fr] lg:px-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
              Built for controlled launch
            </p>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight text-ink md:text-4xl">
              A focused operating layer for approved Sinbad vendors.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
              Vendor access starts after application approval. Product publishing remains reviewed
              by Sinbad, delivery is handled centrally, and commission reporting is available from
              the vendor workspace.
            </p>
            <div className="mt-8">
              <Link
                href="/apply"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Start Application
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex items-center gap-3 rounded-lg border border-line bg-white p-4"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-panel text-ink">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-ink">{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
