"use client";

import { FormEvent, useState } from "react";
import { VendorAuthGate } from "@/components/vendor-auth-gate";
import { VendorShell } from "@/components/vendor-shell";
import { PasswordInput } from "@/components/password-input";
import { supabase } from "@/lib/supabase";

function SettingsContent() {
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
      <h1 className="text-2xl font-semibold text-ink">Settings</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Change the password for your signed-in vendor account.
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
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {message}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <button
          className="h-10 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? "Saving..." : "Save Password"}
        </button>
      </form>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <VendorAuthGate>
      {({ user, vendor, memberships }) => (
        <VendorShell user={user} vendor={vendor} memberships={memberships}>
          <SettingsContent />
        </VendorShell>
      )}
    </VendorAuthGate>
  );
}
