"use client";

import { FormEvent, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { AdminShell } from "@/components/admin-shell";
import { PasswordInput } from "@/components/password-input";
import { supabase } from "@/lib/supabase";

function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

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

    setPassword("");
    setConfirmPassword("");
    setMessage("Password changed successfully.");
  }

  return (
    <section className="max-w-xl rounded-lg border border-line bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-ink">Change Password</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Set a new password for your signed-in Sinbad admin account.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <PasswordInput
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />

        <PasswordInput
          label="Confirm password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
        />

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
          className="h-11 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Saving..." : "Save Password"}
        </button>
      </form>
    </section>
  );
}

export default function ChangePasswordPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <ChangePasswordForm />
        </AdminShell>
      )}
    </AuthGate>
  );
}
