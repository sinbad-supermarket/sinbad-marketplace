"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { sidebarItems } from "@/lib/navigation";
import { supabase } from "@/lib/supabase";

type AdminShellProps = {
  user: User;
  adminRole: string;
  children: React.ReactNode;
};

const sidebarCollapsedStorageKey = "sinbad_admin_sidebar_collapsed";

export function AdminShell({ user, adminRole, children }: AdminShellProps) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const currentItem = sidebarItems.find((item) =>
    item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href)
  );
  const pageTitle = currentItem?.label ?? "Sinbad Admin";

  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem(sidebarCollapsedStorageKey) === "true");
  }, []);

  useEffect(() => {
    window.localStorage.setItem(sidebarCollapsedStorageKey, sidebarCollapsed ? "true" : "false");
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

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
              <div className="text-lg font-semibold text-ink">Sinbad Admin</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Internal Operations
              </div>
            </div>
          ) : null}

          {mobile ? (
            <button
              aria-label="Close admin menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-slate-700 hover:bg-slate-100"
              onClick={() => setMobileMenuOpen(false)}
              type="button"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button
              aria-label={sidebarCollapsed ? "Expand admin menu" : "Collapse admin menu"}
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

        <nav className="flex-1 space-y-1 px-3 py-4">
          {sidebarItems.map((item) => {
            const active =
              item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            const showLabel = !sidebarCollapsed || mobile;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                title={sidebarCollapsed && !mobile ? item.label : undefined}
                className={[
                  "flex h-10 items-center rounded-md text-sm font-medium",
                  showLabel ? "gap-3 px-3" : "justify-center px-0",
                  active
                    ? "bg-ink text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-ink"
                ].join(" ")}
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
    <div className="flex min-h-screen bg-[#eef1f3]">
      <aside
        className={[
          "hidden shrink-0 border-r border-line bg-white transition-[width] duration-200 md:flex md:flex-col",
          sidebarCollapsed ? "md:w-20" : "md:w-72"
        ].join(" ")}
      >
        <SidebarContent />
      </aside>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            aria-label="Close admin menu"
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileMenuOpen(false)}
            type="button"
          />
          <aside className="relative z-10 flex h-full w-72 flex-col border-r border-line bg-white shadow-xl">
            <SidebarContent mobile />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-line bg-white px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Open admin menu"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-slate-700 hover:bg-slate-100 md:hidden"
              onClick={() => setMobileMenuOpen(true)}
              type="button"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{pageTitle}</div>
              <div className="text-xs text-slate-500">English only V1</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-ink">{user.email}</div>
              <div className="text-xs capitalize text-slate-500">{adminRole}</div>
            </div>
            <Link
              href="/change-password"
              className="hidden h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 sm:inline-flex"
            >
              Change Password
            </Link>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              onClick={() => void supabase.auth.signOut()}
              title="Sign Out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
