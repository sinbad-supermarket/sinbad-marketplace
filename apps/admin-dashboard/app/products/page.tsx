"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { AuthGate } from "@/components/auth-gate";
import { supabase } from "@/lib/supabase";

type ProductStatus = "approved" | "publishing" | "published" | "unpublished" | "archived";

type PublishStatus =
  | "not_published"
  | "dry_run_ready"
  | "publishing"
  | "shopify_draft_created"
  | "published"
  | "failed"
  | "failed_needs_review"
  | "rolled_back";

type VendorProduct = {
  id: string;
  vendor_id: string;
  submission_id: string | null;
  title: string;
  status: ProductStatus;
  publish_status: PublishStatus | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  shopify_created_status: string | null;
  created_at: string;
  vendors: {
    name: string;
    slug: string;
  } | null;
};

const statusLabels: Record<ProductStatus, string> = {
  approved: "Approved",
  publishing: "Publishing",
  published: "Published",
  unpublished: "Unpublished",
  archived: "Archived"
};

const statusClasses: Record<ProductStatus, string> = {
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  publishing: "bg-amber-50 text-amber-800 ring-amber-200",
  published: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  unpublished: "bg-slate-100 text-slate-700 ring-slate-200",
  archived: "bg-zinc-100 text-zinc-700 ring-zinc-200"
};

const publishStatusLabels: Record<PublishStatus, string> = {
  not_published: "Not published",
  dry_run_ready: "Dry run ready",
  publishing: "Publishing",
  shopify_draft_created: "Shopify draft created",
  published: "Published",
  failed: "Failed",
  failed_needs_review: "Failed, needs review",
  rolled_back: "Rolled back"
};

const publishStatusClasses: Record<PublishStatus, string> = {
  not_published: "bg-slate-100 text-slate-700 ring-slate-200",
  dry_run_ready: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  publishing: "bg-amber-50 text-amber-800 ring-amber-200",
  shopify_draft_created: "bg-violet-50 text-violet-700 ring-violet-200",
  published: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  failed_needs_review: "bg-rose-50 text-rose-700 ring-rose-200",
  rolled_back: "bg-zinc-100 text-zinc-700 ring-zinc-200"
};

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function shortId(value: string | null) {
  if (!value) return "Not linked";
  if (value.length <= 18) return value;
  return `${value.slice(0, 12)}...${value.slice(-6)}`;
}

function ProductsContent() {
  const [products, setProducts] = useState<VendorProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadProducts() {
      setLoading(true);
      setError(null);

      const { data, error: loadError } = await supabase
        .from("vendor_products")
        .select(
          [
            "id",
            "vendor_id",
            "submission_id",
            "title",
            "status",
            "publish_status",
            "shopify_product_id",
            "shopify_variant_id",
            "shopify_created_status",
            "created_at",
            "vendors(name,slug)"
          ].join(",")
        )
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (loadError) {
        setError(loadError.message);
        setProducts([]);
      } else {
        setProducts((data ?? []) as unknown as VendorProduct[]);
      }

      setLoading(false);
    }

    void loadProducts();

    return () => {
      mounted = false;
    };
  }, []);

  const productCount = useMemo(() => products.length, [products]);

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Products</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Read-only view of approved vendor products and Shopify draft status. Product changes
            still happen through submission review or vendor operational controls.
          </p>
        </div>
        <div className="text-sm font-medium text-slate-600">{productCount} shown</div>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-sm font-medium text-slate-600">Loading products...</div>
        ) : error ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-rose-700">Could not load products</h2>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
          </div>
        ) : products.length === 0 ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-ink">No products found</h2>
            <p className="mt-2 text-sm text-slate-600">
              Products appear here after product submissions are approved.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
              <thead className="border-b border-line bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Product title</th>
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Shopify status</th>
                  <th className="px-4 py-3 font-semibold">Shopify product ID</th>
                  <th className="px-4 py-3 font-semibold">Shopify variant ID</th>
                  <th className="px-4 py-3 font-semibold">Created date</th>
                  <th className="px-4 py-3 font-semibold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {products.map((product) => {
                  const publishStatus = product.publish_status ?? "not_published";
                  const detailHref = product.submission_id
                    ? `/product-submissions/${product.submission_id}`
                    : null;

                  return (
                    <tr
                      key={product.id}
                      className={detailHref ? "cursor-pointer hover:bg-slate-50" : undefined}
                      onClick={() => {
                        if (detailHref) window.location.href = detailHref;
                      }}
                    >
                      <td className="px-4 py-3">
                        <span
                          className={[
                            "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                            statusClasses[product.status]
                          ].join(" ")}
                        >
                          {statusLabels[product.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-ink">{product.title}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {product.vendors?.name ?? "Unknown vendor"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={[
                              "inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1",
                              publishStatusClasses[publishStatus]
                            ].join(" ")}
                          >
                            {publishStatusLabels[publishStatus]}
                          </span>
                          {product.shopify_created_status ? (
                            <span className="text-xs text-slate-500">
                              Shopify: {product.shopify_created_status}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {shortId(product.shopify_product_id)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {shortId(product.shopify_variant_id)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {formatDate(product.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {detailHref ? (
                          <Link
                            href={detailHref}
                            className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            onClick={(event) => event.stopPropagation()}
                          >
                            View submission
                            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </Link>
                        ) : (
                          <span className="text-xs font-medium text-slate-500">
                            No submission link
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export default function ProductsPage() {
  return (
    <AuthGate>
      {({ user, admin }) => (
        <AdminShell user={user} adminRole={admin.role}>
          <ProductsContent />
        </AdminShell>
      )}
    </AuthGate>
  );
}
