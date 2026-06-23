"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import {
  ChevronDown,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X
} from "lucide-react";
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
const sidebarCollapsedStorageKey = "sinbad_vendor_dashboard_sidebar_collapsed";

export function VendorShell({ user, vendor, memberships, children }: VendorShellProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const title =
    navigationItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      ?.label ?? "Vendor Dashboard";

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(sidebarCollapsedStorageKey) === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(sidebarCollapsedStorageKey, sidebarCollapsed ? "true" : "false");
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  function switchVendor(nextVendorId: string) {
    window.localStorage.setItem(selectedVendorStorageKey, nextVendorId);
    window.location.href = "/dashboard";
  }

  function SidebarContent({ mobile = false }: { mobile?: boolean }) {
    return (
      <>
        <div
          className={[
            "flex items-center border-b border-line px-4 py-4",
            sidebarCollapsed && !mobile ? "justify-center" : "justify-between"
          ].join(" ")}
        >
          {!sidebarCollapsed || mobile ? (
            <div>
              <div className="text-lg font-semibold">Sinbad Vendor</div>
              <div className="mt-1 text-xs font-semibold uppercase text-slate-500">
                Vendor Operations
              </div>
            </div>
          ) : null}

          {mobile ? (
            <button
              aria-label="Close vendor menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-slate-700 hover:bg-slate-100"
              onClick={() => setMobileMenuOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              aria-label={sidebarCollapsed ? "Expand vendor menu" : "Collapse vendor menu"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-slate-700 hover:bg-slate-100"
              onClick={() => setSidebarCollapsed((current) => !current)}
              title={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
              type="button"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          )}
        </div>

        <nav className="space-y-1 px-3 py-4">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const showLabel = !sidebarCollapsed || mobile;
            const classes = [
              "flex h-10 items-center rounded-md text-sm font-semibold",
              showLabel ? "gap-3 px-3" : "justify-center px-0",
              active
                ? "bg-ink text-white"
                : item.enabled
                  ? "text-slate-700 hover:bg-slate-100"
                  : "cursor-not-allowed text-slate-400"
            ].join(" ");

            if (!item.enabled) {
              return (
                <span
                  key={item.href}
                  className={classes}
                  aria-disabled="true"
                  aria-label={item.label}
                  title={!showLabel ? item.label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {showLabel ? <span className="truncate">{item.label}</span> : null}
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={classes}
                aria-label={item.label}
                title={!showLabel ? item.label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {showLabel ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-panel text-ink">
      <aside
        className={[
          "fixed inset-y-0 left-0 hidden border-r border-line bg-white transition-[width] duration-200 md:block",
          sidebarCollapsed ? "md:w-20" : "md:w-64"
        ].join(" ")}
      >
        <SidebarContent />
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close vendor menu"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileMenuOpen(false)}
            type="button"
          />
          <aside className="relative z-10 h-full w-72 border-r border-line bg-white shadow-xl">
            <SidebarContent mobile />
          </aside>
        </div>
      ) : null}

      <div className={["transition-[padding] duration-200", sidebarCollapsed ? "md:pl-20" : "md:pl-64"].join(" ")}>
        <header className="sticky top-0 z-10 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex min-h-16 flex-col gap-3 px-5 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                aria-label="Open vendor menu"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-slate-700 hover:bg-slate-100 md:hidden"
                onClick={() => setMobileMenuOpen(true)}
                type="button"
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-500">{title}</div>
                <div className="truncate text-lg font-semibold text-ink">{vendor.vendor.name}</div>
              </div>
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
