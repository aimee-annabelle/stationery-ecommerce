// C1 My account API: types mirror app/api/v1/account.py.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Customer, customerApi } from "../../lib/customerSession";
import { bag } from "../shop/bag";
import type { BagQuote, PublicOrder, Tint } from "../shop/shopApi";

export type MyOrder = {
  id: string;
  number: string;
  placed_at: string;
  status: string;
  items: string;
  item_count: number;
  total_rwf: number;
  payment_label: string;
  payment_status: string;
  can_cancel: boolean;
};

export type MyRequest = {
  id: string;
  number: string;
  type: "invitations" | "binding";
  summary: string;
  status: string;
  needed_by: string | null;
  quote_rwf: number | null;
  ready_on: string | null;
};

export type Overview = {
  current_order: PublicOrder | null;
  current_order_id: string | null;
  open_quote: MyRequest | null;
  buy_again: {
    product_id: string;
    variant_id: string | null;
    slug: string | null;
    name: string;
    tint: Tint | null;
    category_slug: string | null;
    image: string | null;
    last_bought: string;
    available: boolean;
  }[];
};

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const useOverview = () => useQuery({ queryKey: ["me", "overview"], queryFn: () => customerApi<Overview>("/me/overview") });
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export const useMyOrders = (page: number) =>
  useQuery({ queryKey: ["me", "orders", page], queryFn: () => customerApi<Page<MyOrder>>(`/me/orders?page=${page}`), placeholderData: keepPreviousData });
export const useMyRequests = (page: number) =>
  useQuery({ queryKey: ["me", "requests", page], queryFn: () => customerApi<Page<MyRequest>>(`/me/print-requests?page=${page}`), placeholderData: keepPreviousData });

function useMeMutation<TArgs, TOut>(request: (args: TArgs) => Promise<TOut>, onDone?: (out: TOut) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (out) => {
      client.invalidateQueries({ queryKey: ["me"] });
      onDone?.(out);
    },
  });
}

export const useCancelMyOrder = () => useMeMutation((id: string) => customerApi<MyOrder>(`/me/orders/${id}/cancel`, json("POST")));

export const useAcceptQuote = () =>
  useMeMutation((id: string) => customerApi<MyRequest>(`/me/print-requests/${id}/accept-quote`, json("POST")));

/** Reorder: the server adds the items to the account bag; the browser bag follows. */
export const useReorder = () =>
  useMeMutation(
    (id: string) => customerApi<BagQuote>(`/me/orders/${id}/reorder`, json("POST")),
    (quote) =>
      bag.replace(
        quote.lines.map((l) => ({ productId: l.product_id, variantId: l.variant_id, qty: l.qty })),
        { silent: true },
      ),
  );

export const useUpdateProfile = () =>
  useMeMutation((changes: Partial<Pick<Customer, "name" | "phone" | "whatsapp_updates" | "marketing_opt_in">>) =>
    customerApi<Customer>("/me", json("PATCH", changes)),
  );

export const useChangePassword = () =>
  useMeMutation((body: { current_password: string; new_password: string }) =>
    customerApi<{ message: string }>("/me/password", json("POST", body)),
  );
