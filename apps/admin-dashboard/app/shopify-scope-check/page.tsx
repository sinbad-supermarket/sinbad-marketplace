"use client";

import { useState } from "react";
import { ExternalLink, PlugZap, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type ShopifyStatusResult = {
  success?: boolean;
  connected?: boolean;
  read_products: boolean;
  write_products: boolean;
  storeDomain: string;
  needsAuthorization?: boolean;
  shop?: {
    name: string | null;
    myshopifyDomain: string;
  };
  currentAppInstallation?: {
    id: string;
    app: {
      id: string | null;
      title: string | null;
      handle: string | null;
    };
  };
  productReadCapability?: boolean;
  tokenSource?: string;
  connection?: {
    appClientId: string;
    connectedAt: string;
    lastPreflightAt: string | null;
    lastPreflightStatus: string | null;
  };
};

type PreflightResult = {
  ok?: boolean;
  read_products: boolean;
  write_products: boolean;
  storeDomain: string;
  shop: {
    name: string;
    myshopifyDomain: string;
  };
  tokenSource?: string;
};

type State<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: T }
  | { status: "error"; message: string };

export default function ShopifyConnectionPage() {
  const [connectState, setConnectState] = useState<State<{ shopDomain: string; scopes: string }>>({
    status: "idle"
  });
  const [statusState, setStatusState] = useState<State<ShopifyStatusResult>>({ status: "idle" });
  const [preflightState, setPreflightState] = useState<State<PreflightResult>>({ status: "idle" });

  async function startConnection() {
    setConnectState({ status: "loading" });

    const { data, error } = await supabase.functions.invoke("shopify-connect-start", {
      body: {}
    });

    if (error) {
      setConnectState({ status: "error", message: await functionErrorMessage(error) });
      return;
    }

    const authorizationUrl = typeof data?.authorizationUrl === "string" ? data.authorizationUrl : "";
    if (!authorizationUrl) {
      setConnectState({ status: "error", message: "Shopify authorization URL was not returned." });
      return;
    }

    setConnectState({
      status: "success",
      result: {
        shopDomain: String(data?.shopDomain ?? "Not returned"),
        scopes: String(data?.scopes ?? "Not returned")
      }
    });
    window.location.assign(authorizationUrl);
  }

  async function checkStatus() {
    setStatusState({ status: "loading" });

    const { data, error } = await supabase.functions.invoke("shopify-auth-check", {
      body: {}
    });

    if (error) {
      setStatusState({ status: "error", message: await functionErrorMessage(error) });
      return;
    }

    setStatusState({ status: "success", result: data as ShopifyStatusResult });
  }

  async function runPreflight() {
    setPreflightState({ status: "loading" });

    const { data, error } = await supabase.functions.invoke("shopify-create-draft-product", {
      body: { preflight: true }
    });

    if (error) {
      setPreflightState({ status: "error", message: await functionErrorMessage(error) });
      return;
    }

    setPreflightState({ status: "success", result: data as PreflightResult });
  }

  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <section className="mb-6">
            <h1 className="text-2xl font-semibold text-ink">Shopify Connection</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Connect the Sinbad Shopify app with authorization code grant and verify read-only
              access. This page does not create products or modify Shopify.
            </p>
          </section>

          {admin.role === "owner" || admin.role === "admin" ? (
            <div className="space-y-4">
              <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-ink">OAuth connection</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Starts Shopify authorization for <code>read_products,write_products</code>.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void startConnection()}
                    disabled={connectState.status === "loading"}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <PlugZap className="h-4 w-4" aria-hidden="true" />
                    {connectState.status === "loading" ? "Starting..." : "Connect Shopify"}
                  </button>
                </div>
                <StateMessage state={connectState} />
              </section>

              <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-ink">Connection status</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Calls the read-only <code>shopify-auth-check</code> function with your
                      current admin session.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void checkStatus()}
                    disabled={statusState.status === "loading"}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    {statusState.status === "loading" ? "Checking..." : "Check Connection"}
                  </button>
                </div>

                {statusState.status === "error" ? (
                  <ErrorBox message={statusState.message} />
                ) : null}

                {statusState.status === "success" ? (
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <ScopeRow
                      label="Connected"
                      value={statusState.result.connected ? "Yes" : "No"}
                      tone={statusState.result.connected ? "success" : "danger"}
                    />
                    <ScopeRow label="Store domain" value={statusState.result.storeDomain} />
                    <ScopeRow
                      label="Needs authorization"
                      value={statusState.result.needsAuthorization ? "Yes" : "No"}
                      tone={statusState.result.needsAuthorization ? "danger" : "success"}
                    />
                    <ScopeRow
                      label="read_products"
                      value={statusState.result.read_products ? "Granted" : "Missing"}
                      tone={statusState.result.read_products ? "success" : "danger"}
                    />
                    <ScopeRow
                      label="write_products"
                      value={statusState.result.write_products ? "Granted" : "Missing"}
                      tone={statusState.result.write_products ? "success" : "danger"}
                    />
                    <ScopeRow label="Shop name" value={statusState.result.shop?.name ?? "Not returned"} />
                    <ScopeRow
                      label="Shop domain"
                      value={statusState.result.shop?.myshopifyDomain ?? "Not returned"}
                    />
                    <ScopeRow
                      label="App installation ID"
                      value={statusState.result.currentAppInstallation?.id ?? "Not returned"}
                    />
                    <ScopeRow
                      label="App name"
                      value={statusState.result.currentAppInstallation?.app.title ?? "Not returned"}
                    />
                    <ScopeRow
                      label="Product read capability"
                      value={statusState.result.productReadCapability ? "Passed" : "Not confirmed"}
                      tone={statusState.result.productReadCapability ? "success" : "neutral"}
                    />
                    <ScopeRow
                      label="Token source"
                      value={statusState.result.tokenSource ?? "Not returned"}
                    />
                  </div>
                ) : null}
              </section>

              <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-ink">Draft function preflight</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Calls <code>shopify-create-draft-product</code> in read-only preflight mode.
                      No product creation path is invoked.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runPreflight()}
                    disabled={preflightState.status === "loading"}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    {preflightState.status === "loading" ? "Checking..." : "Run Preflight"}
                  </button>
                </div>

                {preflightState.status === "error" ? (
                  <ErrorBox message={preflightState.message} />
                ) : null}

                {preflightState.status === "success" ? (
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <ScopeRow label="Store domain" value={preflightState.result.storeDomain} />
                    <ScopeRow
                      label="Shop domain"
                      value={preflightState.result.shop.myshopifyDomain}
                    />
                    <ScopeRow
                      label="read_products"
                      value={preflightState.result.read_products ? "Granted" : "Missing"}
                      tone={preflightState.result.read_products ? "success" : "danger"}
                    />
                    <ScopeRow
                      label="write_products"
                      value={preflightState.result.write_products ? "Granted" : "Missing"}
                      tone={preflightState.result.write_products ? "success" : "danger"}
                    />
                    <ScopeRow
                      label="Token source"
                      value={preflightState.result.tokenSource ?? "Not returned"}
                    />
                  </div>
                ) : null}
              </section>
            </div>
          ) : (
            <section className="rounded-lg border border-line bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink">Owner/Admin Required</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Shopify connection management is restricted to Sinbad owner/admin users.
              </p>
            </section>
          )}
        </AdminShell>
      )}
    </AuthGate>
  );
}

async function functionErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "context" in error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (typeof context?.json === "function") {
      try {
        return JSON.stringify(await context.json());
      } catch {
        return error instanceof Error ? error.message : "Function request failed";
      }
    }
  }

  return error instanceof Error ? error.message : "Function request failed";
}

function StateMessage<T>({ state }: { state: State<T> }) {
  if (state.status === "error") return <ErrorBox message={state.message} />;
  if (state.status !== "success") return null;

  return (
    <div className="mt-5 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-700">
      Shopify authorization started. If the browser did not redirect, check popup and navigation
      restrictions.
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
    </div>
  );
}

function ScopeRow({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "border-green-200 bg-green-50 text-green-700"
      : tone === "danger"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-line bg-slate-50 text-slate-700";

  return (
    <div className="rounded-md border border-line p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 inline-flex rounded-md border px-2.5 py-1 text-sm font-semibold ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}
