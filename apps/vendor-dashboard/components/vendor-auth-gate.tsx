"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type VendorRole = "owner" | "staff";

export type VendorContext = {
  membershipId: string;
  vendorId: string;
  role: VendorRole;
  vendor: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
};

type VendorMembershipRow = {
  id: string;
  vendor_id: string;
  role: VendorRole;
  status: string;
  vendors:
    | {
        id: string;
        name: string;
        slug: string;
        status: string;
      }
    | {
        id: string;
        name: string;
        slug: string;
        status: string;
      }[]
    | null;
};

type VendorAuthGateProps = {
  children: (state: { user: User; vendor: VendorContext; memberships: VendorContext[] }) => React.ReactNode;
};

type GateState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "denied"; email?: string }
  | { status: "select_vendor"; user: User; memberships: VendorContext[] }
  | { status: "ready"; user: User; vendor: VendorContext; memberships: VendorContext[] };

const selectedVendorStorageKey = "sinbad_vendor_dashboard_selected_vendor_id";

function normalizeMembership(row: VendorMembershipRow): VendorContext | null {
  const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
  if (!vendor || vendor.status !== "active" || row.status !== "active") return null;

  return {
    membershipId: row.id,
    vendorId: row.vendor_id,
    role: row.role,
    vendor
  };
}

export function VendorAuthGate({ children }: VendorAuthGateProps) {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedVendorId(window.localStorage.getItem(selectedVendorStorageKey));
  }, []);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session?.user) {
        setState({ status: "signed_out" });
        return;
      }

      const { data, error } = await supabase
        .from("vendor_users")
        .select("id,vendor_id,role,status,vendors(id,name,slug,status)")
        .eq("user_id", session.user.id)
        .eq("status", "active")
        .order("created_at", { ascending: true });

      if (!mounted) return;

      if (error) {
        setState({ status: "denied", email: session.user.email ?? undefined });
        return;
      }

      const memberships = ((data ?? []) as unknown as VendorMembershipRow[])
        .map(normalizeMembership)
        .filter((membership): membership is VendorContext => Boolean(membership));

      if (memberships.length === 0) {
        setState({ status: "denied", email: session.user.email ?? undefined });
        return;
      }

      const selected =
        memberships.find((membership) => membership.vendorId === selectedVendorId) ??
        (memberships.length === 1 ? memberships[0] : null);

      if (!selected) {
        setState({ status: "select_vendor", user: session.user, memberships });
        return;
      }

      setState({ status: "ready", user: session.user, vendor: selected, memberships });
    }

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(() => {
      void load();
    });

    void load();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [selectedVendorId]);

  const sortedMemberships = useMemo(() => {
    if (state.status !== "ready" && state.status !== "select_vendor") return [];
    return [...state.memberships].sort((a, b) => a.vendor.name.localeCompare(b.vendor.name));
  }, [state]);

  function chooseVendor(vendorId: string) {
    window.localStorage.setItem(selectedVendorStorageKey, vendorId);
    setSelectedVendorId(vendorId);
  }

  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-panel">
        <div className="text-sm font-medium text-slate-600">Loading Sinbad Vendor...</div>
      </main>
    );
  }

  if (state.status === "signed_out") {
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
    return null;
  }

  if (state.status === "denied") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-panel px-6">
        <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-ink">Access Denied</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            This account does not have an active vendor membership.
          </p>
          {state.email ? (
            <p className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
              {state.email}
            </p>
          ) : null}
          <button
            className="mt-6 w-full rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            onClick={() => void supabase.auth.signOut()}
          >
            Sign Out
          </button>
        </section>
      </main>
    );
  }

  if (state.status === "select_vendor") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-panel px-6">
        <section className="w-full max-w-lg rounded-lg border border-line bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-ink">Select Vendor</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Choose which vendor workspace to open.
          </p>
          <div className="mt-5 space-y-2">
            {sortedMemberships.map((membership) => (
              <button
                key={membership.vendorId}
                className="flex w-full items-center justify-between rounded-md border border-line px-4 py-3 text-left text-sm hover:bg-slate-50"
                onClick={() => chooseVendor(membership.vendorId)}
              >
                <span>
                  <span className="block font-semibold text-ink">{membership.vendor.name}</span>
                  <span className="block text-slate-600">{membership.vendor.slug}</span>
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {membership.role}
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return <>{children({ user: state.user, vendor: state.vendor, memberships: state.memberships })}</>;
}
