"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/dashboard");
      }
    });
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-6">
      <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Sinbad Admin</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Sign in with your Sinbad admin account.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            className="h-11 w-full rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>
        </form>
      </section>
    </main>
  );
}
