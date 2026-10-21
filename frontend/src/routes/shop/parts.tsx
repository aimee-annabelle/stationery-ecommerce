// Shared shop pieces from the canvas: header, footer, product art, product card, quantity stepper, bag bar.

import { Link, NavLink, useNavigate } from "react-router-dom";
import { icons } from "../../components/icons";
import { formatRwf } from "../../lib/format";
import { useCustomerSession } from "../../lib/customerSession";
import { strings } from "../../strings";
import { bag, bagUnits, useBag } from "./bag";
import type { Availability, ProductCard as Card, Tint } from "./shopApi";

const t = strings.shop;

export const TINT_BG: Record<Tint, string> = {
  butter: "bg-butter",
  lilac: "bg-lilac",
  blush: "bg-blush",
  sage: "bg-sage",
};

const CATEGORY_ICON: Record<string, keyof typeof icons> = {
  "school-supplies": "note",
  "office-supplies": "folder",
  electronics: "headphones",
  "phone-accessories": "plug",
};

export const categoryIcon = (slug?: string | null) => icons[CATEGORY_ICON[slug ?? ""] ?? "box"];

/** A product's photo, or its category colour and icon when it has none (as on the canvas). */
export function ProductArt({
  image,
  tint,
  categorySlug,
  className = "",
  iconSize = 64,
  color,
}: {
  image: string | null;
  tint: Tint | null;
  categorySlug?: string | null;
  className?: string;
  iconSize?: number;
  color?: string | null; // a chosen option's swatch, shown instead of the category colour
}) {
  const Icon = categoryIcon(categorySlug);
  return (
    <span
      className={`flex items-center justify-center overflow-hidden text-ink ${color ? "" : TINT_BG[tint ?? "sage"]} ${className}`}
      style={color ? { background: color } : undefined}
    >
      {image ? <img src={image} alt="" className="size-full object-cover" /> : <Icon size={iconSize} />}
    </span>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `py-3 no-underline ${isActive ? "border-b-[1.5px] border-ink" : ""}`;

export function ShopHeader() {
  const navigate = useNavigate();
  const units = bagUnits(useBag());
  const { customer } = useCustomerSession();
  return (
    <header className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-3 px-4 py-[22px] sm:gap-x-8 sm:px-6">
      <Link to="/" className="font-heading text-[28px] font-bold no-underline">
        Pahyems<span className="text-terracotta">.</span>
      </Link>
      <nav
        aria-label="Main"
        className="order-3 flex basis-full flex-wrap justify-center gap-x-8 gap-y-1 text-[15px] font-medium md:order-none md:flex-[1_1_300px] md:basis-auto"
      >
        <NavLink to="/" end className={linkClass}>
          {t.nav.home}
        </NavLink>
        <NavLink to="/shop" className={linkClass}>
          {t.nav.shop}
        </NavLink>
        <NavLink to="/services" className={linkClass}>
          {t.nav.services}
        </NavLink>
        <NavLink to="/contact" className={linkClass}>
          {t.nav.contact}
        </NavLink>
      </nav>
      <div className="ml-auto flex gap-2 sm:gap-2.5">
        <button
          type="button"
          aria-label={t.search}
          onClick={() => navigate("/shop?focus=search")}
          className="flex size-[46px] cursor-pointer items-center justify-center rounded-full border border-line bg-white"
        >
          <icons.search size={18} />
        </button>
        <Link
          to="/cart"
          aria-label={t.bagCount(units)}
          className="relative flex size-[46px] items-center justify-center rounded-full border border-line bg-white no-underline"
        >
          <icons.bag size={18} />
          {units > 0 && (
            <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-terracotta px-1 text-[11px] font-bold text-white">
              {units}
            </span>
          )}
        </Link>
        {customer ? (
          <Link
            to="/account"
            aria-label={t.myAccount}
            className="flex min-h-[46px] min-w-[46px] items-center justify-center gap-2 rounded-full bg-ink px-3 text-[15px] font-semibold text-white no-underline sm:px-6"
          >
            <icons.users size={18} />
            <span className="hidden sm:inline">{t.myAccount}</span>
          </Link>
        ) : (
          <>
            <Link
              to="/login"
              className="hidden min-h-[46px] items-center rounded-full border border-line bg-white px-[22px] text-[15px] font-semibold no-underline sm:flex"
            >
              {t.logIn}
            </Link>
            <Link
              to="/signup"
              className="flex min-h-[46px] items-center rounded-full bg-ink px-4 text-[15px] font-semibold text-white no-underline sm:px-6"
            >
              {t.signUp}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

export function ShopFooter() {
  return (
    <footer className="mt-6 border-t border-[#E4E0D6]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-12 gap-y-4 px-4 py-12 sm:px-6">
        <div className="font-heading text-[34px] font-bold">
          Pahyems<span className="text-terracotta">.</span>
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-3 text-base font-medium">
          <span>{t.address}</span>
          <a href={t.phoneHref} className="font-semibold no-underline">
            {t.phone}
          </a>
          <span>{t.hours}</span>
          <Link to="/contact" className="no-underline">
            {t.contactFaq}
          </Link>
        </div>
        <div className="w-full text-[13px] text-muted">{t.copyright}</div>
      </div>
    </footer>
  );
}

export function Price({ amount, className = "" }: { amount: number; className?: string }) {
  return <span className={`font-heading font-semibold ${className}`}>{formatRwf(amount)}</span>;
}

/** Product card from the Home and Shop artboards. */
export function ProductCard({ product }: { product: Card }) {
  const navigate = useNavigate();
  const lines = useBag();
  const inBag = lines.some((l) => l.productId === product.id);
  const out = product.availability === "out_of_stock";

  // Products with options are added from their page, where the option is chosen.
  const onAdd = () => (product.has_variants ? navigate(`/shop/${product.slug}`) : bag.add(product.id, null));
  const label = product.has_variants
    ? t.chooseOption(product.name)
    : inBag
      ? t.inBag(product.name)
      : t.addToBag(product.name);

  return (
    <div className="flex flex-col gap-3.5 rounded-[28px] bg-white p-2.5">
      <Link to={`/shop/${product.slug}`} aria-label={product.name} className="relative block no-underline">
        <ProductArt
          image={product.image}
          tint={product.category.tint}
          categorySlug={product.category.slug}
          className="h-[210px] w-full rounded-[22px]"
        />
        {product.availability !== "in_stock" && (
          <span className="absolute top-3 left-3 rounded-full bg-white px-3 py-[5px] text-xs font-semibold">
            {out ? t.outOfStock : t.fewLeft}
          </span>
        )}
      </Link>
      <div className="flex items-end gap-3 px-2 pb-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="text-[13px] text-muted">{product.category.name}</div>
          <Link to={`/shop/${product.slug}`} className="text-base leading-[1.35] font-semibold no-underline">
            {product.name}
          </Link>
          <Price amount={product.price_rwf} className="text-[21px]" />
        </div>
        <button
          type="button"
          aria-label={label}
          disabled={out}
          onClick={onAdd}
          className={`flex size-[50px] shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-default disabled:opacity-40 ${
            inBag ? "bg-ink text-white" : "bg-paper text-ink"
          }`}
        >
          {inBag && !product.has_variants ? <icons.check size={20} /> : <icons.plus size={20} />}
        </button>
      </div>
    </div>
  );
}

export function ProductGrid({ products, min = 220 }: { products: Card[]; min?: number }) {
  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))` }}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

/** The sticky "N items in your bag · View bag" bar from the Shop artboard. */
export function BagBar() {
  const units = bagUnits(useBag());
  if (units === 0) return null;
  return (
    <div className="sticky bottom-5 z-10 flex justify-center px-4">
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-full bg-ink py-2 pr-2 pl-6 text-white shadow-[0_12px_32px_rgba(34,48,42,0.25)]"
      >
        <span className="text-[15px] font-medium">{t.added(units)}</span>
        <Link
          to="/cart"
          className="flex min-h-11 items-center gap-2 rounded-full bg-sage px-5 text-[15px] font-semibold text-ink no-underline"
        >
          {t.viewBag}
          <icons.arrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  decreaseLabel,
  increaseLabel,
  max = 99,
  tone = "white",
}: {
  value: number;
  onChange: (n: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  max?: number;
  tone?: "white" | "paper";
}) {
  const shell = tone === "white" ? "bg-white" : "bg-paper";
  const button = tone === "white" ? "bg-paper" : "bg-white";
  return (
    <div className={`flex items-center rounded-full p-1 ${shell}`}>
      <button
        type="button"
        aria-label={decreaseLabel}
        onClick={() => onChange(value - 1)}
        className={`size-[46px] cursor-pointer rounded-full text-xl font-semibold ${button}`}
      >
        −
      </button>
      <span aria-live="polite" className="min-w-11 text-center text-[17px] font-semibold">
        {value}
      </span>
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className={`size-[46px] cursor-pointer rounded-full text-xl font-semibold disabled:opacity-40 ${button}`}
      >
        +
      </button>
    </div>
  );
}

export function availabilityLine(availability: Availability) {
  const p = t.product;
  if (availability === "out_of_stock") return { text: p.outOfStock, color: "text-error", dot: "bg-error" };
  if (availability === "few_left") return { text: p.fewLeft, color: "text-[#8A5A00]", dot: "bg-[#C9A227]" };
  return { text: p.inStock, color: "text-[#2F6B45]", dot: "bg-[#2F6B45]" };
}

export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <div className="text-sm text-muted">
      {items.map((item, i) => (
        <span key={item.label}>
          {i > 0 && " / "}
          {item.to ? (
            <Link to={item.to} className="no-underline">
              {item.label}
            </Link>
          ) : (
            item.label
          )}
        </span>
      ))}
    </div>
  );
}
