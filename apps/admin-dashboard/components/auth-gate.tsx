"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type AdminRole = "owner" | "admin" | "reviewer" | "finance";

type AdminProfile = {
  id: string;
  user_id: string;
  role: AdminRole;
  active: boolean;
};

type AdminLookupResult = {
  data: AdminProfile | null;
  error: { message: string } | null;
};

type AuthGateProps = {
  children: (state: { user: User; admin: AdminProfile }) => React.ReactNode;
};

type GateState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "denied"; email?: string }
  | { status: "error"; message: string }
  | { status: "ready"; user: User; admin: AdminProfile };

async function withTimeout<T>(promise: PromiseLike<T>, message: string, timeoutMs = 10_000) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<GateState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const {
          data: { session }
        } = await withTimeout(
          supabase.auth.getSession(),
          "Supabase session lookup timed out."
        );

        if (!mounted) return;

        if (!session?.user) {
          setState({ status: "signed_out" });
          return;
        }

        const { data, error } = (await withTimeout(
          supabase
            .from("admin_users")
            .select("id,user_id,role,active")
            .eq("user_id", session.user.id)
            .eq("active", true)
            .maybeSingle(),
          "Sinbad admin role lookup timed out."
        )) as AdminLookupResult;

        if (!mounted) return;

        if (error || !data) {
          setState({ status: "denied", email: session.user.email ?? undefined });
          return;
        }

        setState({ status: "ready", user: session.user, admin: data as AdminProfile });
      } catch (error) {
        if (!mounted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "Admin authentication failed."
        });
      }
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
  }, []);

  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-panel">
        <div className="text-sm font-medium text-slate-600">Loading Sinbad Admin...</div>
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
            This account is signed in but does not have an active Sinbad admin role.
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

  if (state.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-panel px-6">
        <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-ink">Admin Session Error</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{state.message}</p>
          <button
            className="mt-6 w-full rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </section>
      </main>
    );
  }

  return <>{children({ user: state.user, admin: state.admin })}</>;
}
