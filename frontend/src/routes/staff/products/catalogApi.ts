// Staff catalog API: types mirror app/schemas/catalog.py.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi } from "../../../lib/staffSession";

export type Tint = "butter" | "lilac" | "blush" | "sage";

export type Category = { id: string; name: string; slug: string; tint: Tint; sort_order: number };
export type StaffCategory = Category & { product_count: number };

export type Variant = { id: string; name: string; swatch_hex: string | null; stock_qty: number };
export type ProductImage = { id: string; url: string; sort_order: number };

export type Product = {
  id: string;
  name: string;
  slug: string;
  sku: string;
  category: Category;
  description: string;
  price_rwf: number;
  cost_rwf?: number | null; // missing for workers
  stock_qty: number;
  low_stock_alert: number;
  is_low: boolean;
  location: string | null;
  is_visible: boolean;
  images: ProductImage[];
  variants: Variant[];
  low_stock_flag: { flagged_by: string; flagged_at: string } | null;
};

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export type Movement = {
  id: string;
  at: string;
  product_id: string;
  product_name: string;
  sku: string;
  variant_name: string | null;
  change_qty: number;
  reason: string;
  supplier: string | null;
  note: string | null;
  order_number: string | null;
  by: string;
  unit_cost_rwf?: number | null;
};

export type ProductFilters = { q?: string; category_id?: string; low?: boolean; page?: number; page_size?: number };

export type ProductInput = {
  name: string;
  category_id: string;
  price_rwf: number;
  cost_rwf: number | null;
  sku: string;
  opening_stock?: number;
  low_stock_alert: number;
  description: string;
  location: string | null;
  is_visible: boolean;
};

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const keys = {
  products: ["staff", "products"] as const,
  product: (id: string) => ["staff", "products", id] as const,
  movements: ["staff", "movements"] as const,
  categories: ["staff", "categories"] as const,
};

export function useProducts(filters: ProductFilters) {
  return useQuery({
    queryKey: [...keys.products, filters],
    queryFn: () => staffApi<Page<Product>>(`/staff/products${query(filters)}`),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string) {
  return useQuery({ queryKey: keys.product(id), queryFn: () => staffApi<Product>(`/staff/products/${id}`) });
}

export function useMovements(productId?: string, page = 1) {
  return useQuery({
    queryKey: [...keys.movements, productId ?? "all", page],
    queryFn: () => staffApi<Page<Movement>>(`/staff/stock/movements${query({ product_id: productId, page })}`),
    placeholderData: keepPreviousData,
  });
}

export function useCategories() {
  return useQuery({ queryKey: keys.categories, queryFn: () => staffApi<StaffCategory[]>("/staff/categories") });
}

/** After any product or stock change, refresh lists and the changed product. */
function useProductMutation<TArgs>(request: (args: TArgs) => Promise<Product>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (product) => {
      client.setQueryData(keys.product(product.id), product);
      client.invalidateQueries({ queryKey: keys.products });
      client.invalidateQueries({ queryKey: keys.movements });
      client.invalidateQueries({ queryKey: keys.categories });
    },
  });
}

export const useCreateProduct = () =>
  useProductMutation((body: ProductInput) => staffApi<Product>("/staff/products", json("POST", body)));

export const useUpdateProduct = () =>
  useProductMutation(({ id, ...changes }: Partial<ProductInput> & { id: string }) =>
    staffApi<Product>(`/staff/products/${id}`, json("PATCH", changes)),
  );

export const useReceiveStock = () =>
  useProductMutation(
    (body: { product_id: string; variant_id?: string; qty: number; supplier?: string; unit_cost_rwf?: number }) =>
      staffApi<Product>("/staff/stock/receive", json("POST", body)),
  );

export const useAdjustStock = () =>
  useProductMutation(
    (body: { product_id: string; variant_id?: string; change_qty: number; reason: string; note: string }) =>
      staffApi<Product>("/staff/stock/adjust", json("POST", body)),
  );

export const useAddVariant = () =>
  useProductMutation(({ productId, ...body }: { productId: string; name: string; swatch_hex: string | null }) =>
    staffApi<Product>(`/staff/products/${productId}/variants`, json("POST", body)),
  );

export const useRemoveVariant = () =>
  useProductMutation(({ productId, variantId }: { productId: string; variantId: string }) =>
    staffApi<Product>(`/staff/products/${productId}/variants/${variantId}`, { method: "DELETE" }),
  );

export const useAddPhoto = () =>
  useProductMutation(({ productId, file }: { productId: string; file: File }) => {
    const form = new FormData();
    form.append("file", file);
    return staffApi<Product>(`/staff/products/${productId}/images`, { method: "POST", body: form });
  });

export const useRemovePhoto = () =>
  useProductMutation(({ productId, imageId }: { productId: string; imageId: string }) =>
    staffApi<Product>(`/staff/products/${productId}/images/${imageId}`, { method: "DELETE" }),
  );

export const useReorderPhotos = () =>
  useProductMutation(({ productId, imageIds }: { productId: string; imageIds: string[] }) =>
    staffApi<Product>(`/staff/products/${productId}/images/order`, json("PUT", { image_ids: imageIds })),
  );

export function useFlagLowStock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      staffApi<{ flagged_by: string; notified: string[]; already_flagged: boolean }>(
        `/staff/products/${productId}/low-stock-flag`,
        { method: "POST" },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.products }),
  });
}

function useCategoryMutation<TArgs>(request: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: keys.categories });
      client.invalidateQueries({ queryKey: keys.products });
    },
  });
}

export const useCreateCategory = () =>
  useCategoryMutation((body: { name: string; tint?: Tint }) => staffApi("/staff/categories", json("POST", body)));

export const useUpdateCategory = () =>
  useCategoryMutation(({ id, ...body }: { id: string; name?: string; tint?: Tint; sort_order?: number }) =>
    staffApi(`/staff/categories/${id}`, json("PATCH", body)),
  );

export const useDeleteCategory = () =>
  useCategoryMutation((id: string) => staffApi(`/staff/categories/${id}`, { method: "DELETE" }));

export const tintVar = (tint: Tint) => `var(--${tint})`;
