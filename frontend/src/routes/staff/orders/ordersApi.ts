// Staff orders API: types mirror app/schemas/staff_orders.py.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi } from "../../../lib/staffSession";

export type OrderStatus = "new" | "preparing" | "ready" | "collected" | "cancelled";

export type OrderRow = {
  id: string;
  number: string;
  source: "online" | "walk_in";
  placed_at: string;
  customer: string;
  phone: string | null;
  items: number;
  total_rwf: number;
  payment: string;
  payment_method: string;
  payment_status: string;
  status: OrderStatus;
  expired: boolean;
};

export type OrderDetail = OrderRow & {
  email: string | null;
  pickup_day: string | null;
  paid_with: string | null;
  transaction_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
  cancel_reason: string | null;
  created_by: string | null;
  line_items: {
    id: string;
    name: string;
    variant_name: string | null;
    qty: number;
    unit_price_rwf: number;
    line_total_rwf: number;
    picked: boolean;
    location: string | null;
  }[];
  history: { status: OrderStatus; from_status: string | null; event: string | null; note: string | null; who: string; at: string }[];
  hold_days: number;
  prefers_call: boolean;
};

export type Receipt = {
  number: string;
  placed_at: string;
  shop: { name: string; address: string; phone: string };
  show_tin: boolean;
  tin: string | null;
  footer: string;
  returns_policy: string | null;
  customer: string;
  served_by: string | null;
  payment: string;
  lines: OrderDetail["line_items"];
  total_rwf: number;
};

export type Dashboard = {
  role: "owner" | "manager" | "worker";
  today: string;
  kpis: Record<string, number>;
  queue: { id: string; number: string; customer: string; items: number; payment: string; payment_status: string; payment_method: string; status: OrderStatus }[];
  sales_7d?: { day: string; total_rwf: number }[];
  low_stock?: { product_id: string; name: string; left: number; alert: number; flagged: boolean }[];
  restock?: { product_id: string; name: string; left: number; alert: number; flagged: boolean }[];
  moves?: { name: string; change: number; reason: string; by: string }[];
  activity?: { action: string; label: string | null; after: Record<string, unknown> | null; at: string; who: string; what: string }[];
  pocket?: {
    online_today: number;
    walk_in_today: number;
    requests_due_tomorrow: number;
    needs_eye: { id: string; at: string; who: string; what: string; kind_label: string; action: string }[];
  };
  on_shift?: { name: string; role: string; actions: number }[];
};

export type WhatsAppTemplate = "ready" | "payment_rejected" | "receipt" | "general";

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const orderKeys = {
  all: ["staff", "orders"] as const,
  one: (id: string) => ["staff", "orders", id] as const,
  dashboard: ["staff", "dashboard"] as const,
};

export function useOrders(params: { status?: string; q?: string; page?: number }) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  if (params.page && params.page > 1) search.set("page", String(params.page));
  return useQuery({
    queryKey: [...orderKeys.all, params],
    queryFn: () =>
      staffApi<{ items: OrderRow[]; total: number; page: number; page_size: number; counts: Record<string, number> }>(
        `/staff/orders${search.toString() ? `?${search}` : ""}`,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000, // new online orders show up without a reload
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.one(id ?? ""),
    queryFn: () => staffApi<OrderDetail>(`/staff/orders/${id}`),
    enabled: !!id,
  });
}

export function useDashboard() {
  return useQuery({ queryKey: orderKeys.dashboard, queryFn: () => staffApi<Dashboard>("/staff/dashboard"), refetchInterval: 60_000 });
}

export function useReceipt(id: string) {
  return useQuery({ queryKey: ["staff", "receipt", id], queryFn: () => staffApi<Receipt>(`/staff/orders/${id}/receipt`) });
}

/** Any order change: store the new detail, refresh lists, the dashboard and stock. */
function useOrderMutation<TArgs>(request: (args: TArgs) => Promise<OrderDetail>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (order) => {
      client.setQueryData(orderKeys.one(order.id), order);
      client.invalidateQueries({ queryKey: orderKeys.all, predicate: (q) => q.queryKey[2] !== order.id });
      client.invalidateQueries({ queryKey: orderKeys.dashboard });
      client.invalidateQueries({ queryKey: ["staff", "products"] });
    },
  });
}

export const useAdvance = () =>
  useOrderMutation(({ id, paid_with }: { id: string; paid_with?: "cash" | "mobile_money" }) =>
    staffApi<OrderDetail>(`/staff/orders/${id}/status`, json("POST", paid_with ? { paid_with } : {})),
  );

export const usePick = () =>
  useOrderMutation(({ id, itemId, picked }: { id: string; itemId: string; picked: boolean }) =>
    staffApi<OrderDetail>(`/staff/orders/${id}/items/${itemId}`, json("PATCH", { picked })),
  );

export const useVerify = () =>
  useOrderMutation(({ id, found }: { id: string; found: boolean }) =>
    staffApi<OrderDetail>(`/staff/orders/${id}/verify-payment`, json("POST", { found })),
  );

export const useCancel = () =>
  useOrderMutation(({ id, reason, refund_confirmed }: { id: string; reason: string; refund_confirmed: boolean }) =>
    staffApi<OrderDetail>(`/staff/orders/${id}/cancel`, json("POST", { reason, refund_confirmed })),
  );

export const useWalkIn = () =>
  useOrderMutation(
    (body: {
      items: { product_id: string; variant_id: string | null; qty: number }[];
      paid_with: "cash" | "mobile_money";
      name?: string;
      phone?: string;
    }) => staffApi<OrderDetail>("/staff/orders", json("POST", body)),
  );

/** Opens WhatsApp with the message typed in. The window opens first so phone browsers don't block it. */
export function useWhatsApp() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, template }: { id: string; template: WhatsAppTemplate }) => {
      const tab = window.open("", "_blank");
      try {
        const { url } = await staffApi<{ url: string; text: string }>(`/staff/orders/${id}/whatsapp-link`, json("POST", { template }));
        if (tab) tab.location.href = url;
        else window.location.href = url;
      } catch (error) {
        tab?.close();
        throw error;
      }
      return id;
    },
    onSuccess: (id) => client.invalidateQueries({ queryKey: orderKeys.one(id) }),
  });
}
