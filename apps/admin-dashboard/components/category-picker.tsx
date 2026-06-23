"use client";

import { useMemo } from "react";

export type ProductCategory = {
  category_id: string;
  name: string;
  parent_name: string | null;
};

type CategoryPickerProps = {
  categories: ProductCategory[];
  loading: boolean;
  selectedCategoryId: string;
  search: string;
  suggestedCategory: string;
  useSuggestedCategory: boolean;
  onSearchChange: (value: string) => void;
  onSelectCategory: (categoryId: string) => void;
  onUseSuggestedCategoryChange: (value: boolean) => void;
  onSuggestedCategoryChange: (value: string) => void;
};

export function CategoryPicker({
  categories,
  loading,
  selectedCategoryId,
  search,
  suggestedCategory,
  useSuggestedCategory,
  onSearchChange,
  onSelectCategory,
  onUseSuggestedCategoryChange,
  onSuggestedCategoryChange
}: CategoryPickerProps) {
  const selectedCategory = categories.find((category) => category.category_id === selectedCategoryId);
  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return categories.slice(0, 8);

    return categories
      .filter((category) =>
        [category.name, category.parent_name]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query))
      )
      .slice(0, 8);
  }, [categories, search]);

  return (
    <div className="md:col-span-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">Category</div>
          <div className="mt-1 text-xs text-slate-500">
            Search synced Shopify collections. Suggest a category only when none fits.
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            checked={useSuggestedCategory}
            className="h-4 w-4 rounded border-line"
            onChange={(event) => onUseSuggestedCategoryChange(event.target.checked)}
            type="checkbox"
          />
          No suitable category
        </label>
      </div>

      {!useSuggestedCategory ? (
        <div className="mt-2">
          <input
            className="h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink"
            placeholder={loading ? "Loading categories..." : "Search categories"}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />

          {selectedCategory ? (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              Selected: {selectedCategory.parent_name ? `${selectedCategory.parent_name} / ` : ""}
              {selectedCategory.name}
            </div>
          ) : null}

          <div className="mt-2 max-h-56 overflow-auto rounded-md border border-line bg-white">
            {filteredCategories.length > 0 ? (
              filteredCategories.map((category) => (
                <button
                  key={category.category_id}
                  className={[
                    "block w-full border-b border-line px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50",
                    category.category_id === selectedCategoryId ? "bg-slate-100 font-semibold" : ""
                  ].join(" ")}
                  onClick={() => onSelectCategory(category.category_id)}
                  type="button"
                >
                  <span className="block text-ink">{category.name}</span>
                  {category.parent_name ? (
                    <span className="mt-0.5 block text-xs text-slate-500">{category.parent_name}</span>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-3 text-sm text-slate-500">
                {loading ? "Loading categories..." : "No matching categories."}
              </div>
            )}
          </div>
        </div>
      ) : (
        <label className="mt-2 block">
          <span className="text-sm font-semibold text-ink">Suggested category</span>
          <input
            className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm text-ink outline-none focus:border-ink"
            maxLength={120}
            placeholder="Enter the best category name"
            value={suggestedCategory}
            onChange={(event) => onSuggestedCategoryChange(event.target.value)}
          />
        </label>
      )}
    </div>
  );
}
