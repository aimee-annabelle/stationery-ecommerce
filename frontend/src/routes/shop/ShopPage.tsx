// 1 · Shop (design/Shop.dc.html). Filters live in the URL so results can be shared and the back button works.

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { icons } from "../../components/icons";
import { strings } from "../../strings";
import { BagBar, Breadcrumb, ProductGrid } from "./parts";
import { type ProductQuery, useCategories, useProducts } from "./shopApi";

const t = strings.shop.list;
const SORTS = ["featured", "az", "za"] as const;
const PAGE_SIZE = 12;

const toInt = (value: string | null) => (value && /^\d+$/.test(value) ? Number(value) : undefined);

export function ShopPage() {
  const [params, setParams] = useSearchParams();
  const categories = useCategories();
  const searchRef = useRef<HTMLInputElement>(null);

  const q = params.get("q") ?? "";
  const selected = params.getAll("category");
  const minPrice = toInt(params.get("min"));
  const maxPrice = toInt(params.get("max"));
  const inStock = params.get("stock") === "1";
  const sort = (SORTS as readonly string[]).includes(params.get("sort") ?? "") ? (params.get("sort") as ProductQuery["sort"]) : "featured";
  const page = toInt(params.get("page")) ?? 1;

  // Typing updates the URL after a short pause so each key press isn't a new search.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => {
    const timer = setTimeout(() => draft !== q && update({ q: draft || null }), 300);
    return () => clearTimeout(timer);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (params.get("focus") === "search") searchRef.current?.focus();
  }, [params]);

  const products = useProducts({
    q: q || undefined,
    category: selected,
    min_price: minPrice,
    max_price: maxPrice,
    in_stock: inStock,
    sort,
    page,
    page_size: PAGE_SIZE,
  });

  function update(changes: Record<string, string | string[] | null>, keepPage = false) {
    const next = new URLSearchParams(params);
    next.delete("focus");
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value) next.set(key, value);
    }
    if (!keepPage) next.delete("page");
    setParams(next, { replace: !keepPage });
  }

  const toggleCategory = (slug: string) =>
    update({ category: selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug] });

  const active: { label: string; remove: () => void }[] = [
    ...selected.map((slug) => ({
      label: categories.data?.find((c) => c.slug === slug)?.name ?? slug,
      remove: () => toggleCategory(slug),
    })),
    ...(minPrice !== undefined ? [{ label: t.minLabel(minPrice.toLocaleString("en-US")), remove: () => update({ min: null }) }] : []),
    ...(maxPrice !== undefined ? [{ label: t.maxLabel(maxPrice.toLocaleString("en-US")), remove: () => update({ max: null }) }] : []),
    ...(inStock ? [{ label: t.inStockOnly, remove: () => update({ stock: null }) }] : []),
    ...(q ? [{ label: t.quoted(q), remove: () => update({ q: null }) }] : []),
  ];
  const clearAll = () => setParams(new URLSearchParams(), { replace: true });

  const total = products.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pt-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6 rounded-[36px] bg-sage p-7 sm:p-12">
          <div className="flex flex-col gap-2.5">
            <Breadcrumb items={[{ label: strings.shop.nav.home, to: "/" }, { label: t.breadcrumb }]} />
            <h1 className="m-0 font-heading text-[44px] leading-none font-medium sm:text-[60px]">{t.title}</h1>
          </div>
          <div className="flex min-h-14 flex-[0_1_460px] items-center gap-2.5 rounded-full bg-white pr-2 pl-5 focus-within:outline-2 focus-within:outline-ink">
            <icons.search size={18} />
            <label htmlFor="shop-search" className="sr-only">
              {t.searchLabel}
            </label>
            <input
              id="shop-search"
              ref={searchRef}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="min-h-11 min-w-0 flex-1 bg-transparent text-base font-medium outline-none"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-8 px-4 pt-9 pb-[72px] sm:px-6">
        <aside className="flex flex-[1_1_240px] flex-col gap-[22px] rounded-[28px] bg-white p-6">
          <div className="flex items-center justify-between">
            <span className="text-[17px] font-bold">{t.filters}</span>
            {active.length > 0 && (
              <button type="button" onClick={clearAll} className="min-h-11 cursor-pointer text-sm font-semibold text-error">
                {t.clearAll}
              </button>
            )}
          </div>
          {active.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {active.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  aria-label={t.removeFilter(a.label)}
                  onClick={a.remove}
                  className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full bg-paper pr-2.5 pl-3.5 text-[13px] font-medium"
                >
                  {a.label}
                  <icons.close size={12} />
                </button>
              ))}
            </div>
          )}
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1.5 text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">{t.category}</legend>
            {categories.data?.map((c) => (
              <Checkbox
                key={c.id}
                checked={selected.includes(c.slug)}
                onChange={() => toggleCategory(c.slug)}
                label={c.name}
                count={c.product_count}
              />
            ))}
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
            <legend className="mb-2.5 text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">{t.price}</legend>
            <div className="flex gap-2.5">
              <PriceInput label={t.min} placeholder="0" value={minPrice} onCommit={(v) => update({ min: v })} />
              <PriceInput label={t.max} placeholder={t.any} value={maxPrice} onCommit={(v) => update({ max: v })} />
            </div>
          </fieldset>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1.5 text-[13px] font-semibold tracking-[0.08em] text-muted uppercase">{t.availability}</legend>
            <Checkbox checked={inStock} onChange={() => update({ stock: inStock ? null : "1" })} label={t.inStockOnly} />
          </fieldset>
          <div className="rounded-[18px] bg-sage p-4 text-sm leading-normal">{t.pickupNote}</div>
        </aside>

        <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] text-muted" aria-live="polite">
              {products.data ? t.results(total) : strings.shop.loading}
            </span>
            <div className="flex flex-wrap items-center gap-1.5 rounded-full bg-white p-[5px]">
              <span className="pr-2 pl-3 text-sm text-muted">{t.sort}</span>
              {SORTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={sort === s}
                  onClick={() => update({ sort: s === "featured" ? null : s })}
                  className={`min-h-10 cursor-pointer rounded-full px-4 text-sm font-semibold ${
                    sort === s ? "bg-ink text-white" : "bg-transparent text-ink"
                  }`}
                >
                  {t.sorts[s]}
                </button>
              ))}
            </div>
          </div>

          {products.data && total === 0 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-[28px] bg-white px-6 py-14 text-center">
              <div className="font-heading text-[28px]">{t.emptyTitle}</div>
              <div className="text-[15px] text-muted">{t.emptyText}</div>
              <button
                type="button"
                onClick={clearAll}
                className="mt-2 min-h-[46px] cursor-pointer rounded-full bg-ink px-[22px] text-[15px] font-semibold text-white"
              >
                {t.reset}
              </button>
            </div>
          ) : (
            <ProductGrid products={products.data?.items ?? []} />
          )}

          {pages > 1 && (
            <nav aria-label={t.pages} className="flex flex-wrap justify-center gap-2 pt-3">
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={t.page(n)}
                  aria-current={n === page ? "page" : undefined}
                  onClick={() => update({ page: n === 1 ? null : String(n) }, true)}
                  className={`size-[46px] cursor-pointer rounded-full text-[15px] font-semibold ${
                    n === page ? "bg-ink text-white" : "border border-line bg-white"
                  }`}
                >
                  {n}
                </button>
              ))}
              {page < pages && (
                <button
                  type="button"
                  aria-label={t.next}
                  onClick={() => update({ page: String(page + 1) }, true)}
                  className="flex size-[46px] cursor-pointer items-center justify-center rounded-full border border-line bg-white"
                >
                  <icons.chevronRight size={18} />
                </button>
              )}
            </nav>
          )}
        </div>
      </section>
      <BagBar />
    </>
  );
}

function Checkbox({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className="flex min-h-11 cursor-pointer items-center gap-3 text-left text-[15px] font-medium"
    >
      <span
        className={`flex size-[22px] shrink-0 items-center justify-center rounded-[7px] border-[1.5px] text-white ${
          checked ? "border-ink bg-ink" : "border-[#A9B3AC] bg-white"
        }`}
      >
        {checked && <icons.check size={14} />}
      </span>
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-[13px] text-muted">{count}</span>}
    </button>
  );
}

function PriceInput({
  label,
  placeholder,
  value,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: number | undefined;
  onCommit: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? "");
  useEffect(() => setDraft(value?.toString() ?? ""), [value]);
  const commit = () => onCommit(/^\d+$/.test(draft) ? draft : null);
  return (
    <label className="flex flex-1 flex-col gap-1 text-xs text-muted">
      {label}
      <input
        type="number"
        min={0}
        inputMode="numeric"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="min-h-[42px] w-full rounded-xl border border-line px-3 text-sm font-medium text-ink"
      />
    </label>
  );
}
