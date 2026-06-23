"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [verifyingRecovery, setVerifyingRecovery] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadRecoverySession() {
      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");

      if (tokenHash && type === "recovery") {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery"
        });

        if (!mounted) return;

        if (verifyError) {
          setError(verifyError.message);
          setSessionReady(false);
          setVerifyingRecovery(false);
          return;
        }

        window.history.replaceState(null, "", window.location.pathname);
      }

      const { data } = await supabase.auth.getSession();

      if (mounted) {
        setSessionReady(Boolean(data.session));
        setVerifyingRecovery(false);
      }
    }

    void loadRecoverySession();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setSessionReady(Boolean(session));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Password updated. Redirecting to sign in...");
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-6">
      <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-ink">Create New Password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Use the password reset link from your email, then set a new admin password here.
        </p>

        {verifyingRecovery ? (
          <div className="mt-6 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
            Verifying password reset link...
          </div>
        ) : null}

        {!verifyingRecovery && !sessionReady ? (
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Reset session is not ready. Open the latest password reset email link, or request a new one.
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">New password</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Confirm password</span>
            <input
              className="mt-1 h-11 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-ink"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          {message ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            className="h-11 w-full rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading || verifyingRecovery || !sessionReady}
          >
            {loading ? "Updating..." : "Update Password"}
          </button>
        </form>

        <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-ink hover:underline">
          Back to sign in
        </Link>
      </section>
    </main>
  );
}
