"use client";

import { useState } from "react";
import Link from "next/link";
import { PasswordInput } from "@/components/password-input";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    window.location.href = "/dashboard";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-6">
      <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-ink">Sinbad Vendor</h1>
        <p className="mt-2 text-sm text-slate-600">Sign in to your vendor workspace.</p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Email</span>
            <input
              className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <PasswordInput
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />

          <div className="text-right">
            <Link href="/forgot-password" className="text-sm font-semibold text-ink hover:underline">
              Forgot password?
            </Link>
          </div>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              {error}
            </div>
          ) : null}

          <button
            className="h-10 w-full rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </section>
    </main>
  );
}
