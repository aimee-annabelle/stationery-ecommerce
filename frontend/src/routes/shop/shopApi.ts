// Public shop API. Types mirror app/schemas/shop.py.

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { customerToken } from "../../lib/customerSession";
import type { BagLine } from "./bag";

export type Tint = "butter" | "lilac" | "blush" | "sage";
export type Availability = "in_stock" | "few_left" | "out_of_stock";
export type Category = { id: string; name: string; slug: string; tint: Tint; sort_order: number };

export type ProductCard = {
  id: string;
  slug: string;
  name: string;
  category: Category;
  price_rwf: number;
  availability: Availability;
  image: string | null;
  has_variants: boolean;
};

export type ProductDetail = ProductCard & {
  summary: string;
  description: string;
  specs: { label: string; value: string }[];
  images: { id: string; url: string; sort_order: number }[];
  variants: { id: string; name: string; swatch_hex: string | null; availability: Availability }[];
  related: ProductCard[];
};

export type ProductQuery = {
  q?: string;
  category?: string[];
  min_price?: number;
  max_price?: number;
  in_stock?: boolean;
  sort?: "featured" | "az" | "za";
  page?: number;
  page_size?: number;
};

export type BagQuote = {
  lines: {
    product_id: string;
    variant_id: string | null;
    slug: string | null;
    name: string;
    variant_name: string | null;
    category_name: string | null;
    category_slug: string | null;
    tint: Tint | null;
    image: string | null;
    qty: number;
    unit_price_rwf: number;
    line_total_rwf: number;
    problem: string | null;
    problem_code: string | null;
  }[];
  units: number;
  total_rwf: number;
  can_checkout: boolean;
};

export type PaymentMethod = "momo" | "airtel" | "pay_at_pickup";

export type PublicOrder = {
  number: string;
  status: string;
  placed_at: string;
  pickup_day: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  payment_method: string;
  payment_label: string;
  payment_status: string;
  transaction_id_sent: boolean;
  total_rwf: number;
  items: { name: string; variant_name: string | null; qty: number; unit_price_rwf: number; line_total_rwf: number }[];
  pay: { method: string; label: string; merchant_code: string; amount_rwf: number; reference: string } | null;
};

export type PublicSettings = {
  shop: { name: string; address: string; phone: string; whatsapp: string; email: string };
  payment_methods: {
    momo: { enabled: boolean; merchant_code: string | null };
    airtel: { enabled: boolean; merchant_code: string | null };
    pay_at_pickup: { enabled: boolean };
  };
  allow_guest_checkout: boolean;
  pickup_hold_days: number;
  default_low_stock_alert: number;
  closures: string[];
  hours: Record<string, { open: string; close: string; closed: boolean }>;
  pickup_days: string[];
  returns_policy: string | null;
};

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

function search(params: ProductQuery): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => out.append(key, v));
    else if (value !== undefined && value !== "" && value !== false) out.set(key, String(value));
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}

export function useCategories() {
  return useQuery({
    queryKey: ["shop", "categories"],
    queryFn: () => api<(Category & { product_count: number })[]>("/categories"),
    staleTime: 5 * 60_000,
  });
}

export function useProducts(params: ProductQuery) {
  return useQuery({
    queryKey: ["shop", "products", params],
    queryFn: () =>
      api<{ items: ProductCard[]; total: number; page: number; page_size: number }>(`/products${search(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(slug: string) {
  return useQuery({ queryKey: ["shop", "product", slug], queryFn: () => api<ProductDetail>(`/products/${slug}`) });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ["shop", "settings"],
    queryFn: () => api<PublicSettings>("/settings/public"),
    staleTime: 5 * 60_000,
  });
}

const toItems = (lines: BagLine[]) =>
  lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, qty: l.qty }));

/** Server prices and availability for the bag. Re-runs whenever the bag changes. */
export function useBagQuote(lines: BagLine[]) {
  return useQuery({
    queryKey: ["shop", "quote", lines],
    queryFn: () => api<BagQuote>("/cart/quote", json("POST", { items: toItems(lines) })),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function usePlaceOrder() {
  return useMutation({
    mutationFn: (body: {
      lines: BagLine[];
      name: string;
      phone: string;
      email: string | null;
      pickup_day: string;
      payment_method: PaymentMethod;
    }) => {
      const { lines, ...rest } = body;
      return api<PublicOrder>("/orders", json("POST", { items: toItems(lines), ...rest }), customerToken());
    },
  });
}

export function useTrackOrder() {
  return useMutation({
    mutationFn: (body: { number: string; phone: string }) => api<PublicOrder>("/orders/track", json("POST", body)),
  });
}

export function useSendPayment() {
  return useMutation({
    mutationFn: ({ number, ...body }: { number: string; phone: string; method: "momo" | "airtel"; transaction_id: string }) =>
      api<PublicOrder>(`/orders/${encodeURIComponent(number)}/payment`, json("POST", body)),
  });
}

const DAY_NAMES: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** Opening hours from S8 as one line ("Mon–Fri 08:00–18:00 · Sat 09:00–14:00"), or the placeholder until set. */
export function useOpeningHours(placeholder: string): string {
  const settings = usePublicSettings();
  const hours = settings.data?.hours;
  if (!hours) return placeholder;
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const label = (d: string) => (hours[d]?.closed ? "closed" : `${hours[d]?.open}–${hours[d]?.close}`);
  if (days.some((d) => !hours[d]?.closed && (hours[d]?.open.startsWith("[") || hours[d]?.close.startsWith("[")))) return placeholder;
  const groups: { from: string; to: string; text: string }[] = [];
  for (const d of days) {
    const text = label(d);
    const last = groups.at(-1);
    if (last && last.text === text) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  return groups
    .filter((g) => g.text !== "closed")
    .map((g) => `${DAY_NAMES[g.from]}${g.from !== g.to ? `–${DAY_NAMES[g.to]}` : ""} ${g.text}`)
    .join(" · ");
}
