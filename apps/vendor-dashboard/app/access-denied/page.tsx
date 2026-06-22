export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-6">
      <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Access Denied</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This account does not have access to an active vendor workspace.
        </p>
      </section>
    </main>
  );
}
