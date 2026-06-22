"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { ChevronDown, LogOut } from "lucide-react";
import { navigationItems } from "@/lib/navigation";
import { supabase } from "@/lib/supabase";
import type { VendorContext } from "@/components/vendor-auth-gate";

type VendorShellProps = {
  user: User;
  vendor: VendorContext;
  memberships: VendorContext[];
  children: React.ReactNode;
};

const selectedVendorStorageKey = "sinbad_vendor_dashboard_selected_vendor_id";

export function VendorShell({ user, vendor, memberships, children }: VendorShellProps) {
  const pathname = usePathname();
  const title =
    navigationItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      ?.label ?? "Vendor Dashboard";

  function switchVendor(nextVendorId: string) {
    window.localStorage.setItem(selectedVendorStorageKey, nextVendorId);
    window.location.href = "/dashboard";
  }

  return (
    <div className="min-h-screen bg-panel text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-white lg:block">
        <div className="border-b border-line px-6 py-5">
          <div className="text-lg font-semibold">Sinbad Vendor</div>
          <div className="mt-1 text-xs font-semibold uppercase text-slate-500">
            Vendor Operations
          </div>
        </div>
        <nav className="space-y-1 px-3 py-4">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const classes = [
              "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold",
              active
                ? "bg-ink text-white"
                : item.enabled
                  ? "text-slate-700 hover:bg-slate-100"
                  : "cursor-not-allowed text-slate-400"
            ].join(" ");

            if (!item.enabled) {
              return (
                <span key={item.href} className={classes} aria-disabled="true">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </span>
              );
            }

            return (
              <Link key={item.href} href={item.href} className={classes}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex min-h-16 flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <div className="text-sm font-semibold text-slate-500">{title}</div>
              <div className="text-lg font-semibold text-ink">{vendor.vendor.name}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {memberships.length > 1 ? (
                <label className="flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700">
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  <select
                    className="bg-transparent outline-none"
                    value={vendor.vendorId}
                    onChange={(event) => switchVendor(event.target.value)}
                  >
                    {memberships.map((membership) => (
                      <option key={membership.vendorId} value={membership.vendorId}>
                        {membership.vendor.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {vendor.role}
              </span>
              <span className="text-sm font-medium text-slate-600">{user.email}</span>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                onClick={() => void supabase.auth.signOut()}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </div>
        </header>

        <main className="px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
