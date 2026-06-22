"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";
import { sidebarItems } from "@/lib/navigation";
import { supabase } from "@/lib/supabase";

type AdminShellProps = {
  user: User;
  adminRole: string;
  children: React.ReactNode;
};

export function AdminShell({ user, adminRole, children }: AdminShellProps) {
  const pathname = usePathname();
  const currentItem = sidebarItems.find((item) =>
    item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href)
  );
  const pageTitle = currentItem?.label ?? "Sinbad Admin";

  return (
    <div className="flex min-h-screen bg-[#eef1f3]">
      <aside className="hidden w-72 shrink-0 border-r border-line bg-white lg:flex lg:flex-col">
        <div className="border-b border-line px-5 py-5">
          <div className="text-lg font-semibold text-ink">Sinbad Admin</div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Internal Operations
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {sidebarItems.map((item) => {
            const active =
              item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium",
                  active
                    ? "bg-ink text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-ink"
                ].join(" ")}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-line bg-white px-4 lg:px-6">
          <div>
            <div className="text-sm font-semibold text-ink">{pageTitle}</div>
            <div className="text-xs text-slate-500">English only V1</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-ink">{user.email}</div>
              <div className="text-xs capitalize text-slate-500">{adminRole}</div>
            </div>
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
