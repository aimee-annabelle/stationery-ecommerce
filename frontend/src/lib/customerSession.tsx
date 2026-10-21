// Customer sign-in (email only). The access token lives in memory; the refresh token is an httpOnly cookie
// sent to /api/v1/auth. While signed in, the bag is kept on the server (PUT /cart) as well as in the browser.

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { bag, type BagLine, onBagChange } from "../routes/shop/bag";
import { api, ApiError } from "./api";

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  email_verified_at: string | null;
  marketing_opt_in: boolean;
  whatsapp_updates: boolean;
};

type TokenResponse = { access_token: string; customer: Customer };
type ServerBag = { lines: { product_id: string; variant_id: string | null; qty: number }[] };

// Only a hint so guests don't call /auth/refresh on every page; the cookie is what counts.
const HINT = "pahyems.customer.v1";
const hint = {
  get: () => {
    try {
      return localStorage.getItem(HINT) === "1";
    } catch {
      return false;
    }
  },
  set: (on: boolean) => {
    try {
      if (on) localStorage.setItem(HINT, "1");
      else localStorage.removeItem(HINT);
    } catch {
      /* ignore */
    }
  },
};

let accessToken: string | null = null;
let refreshing: Promise<Customer | null> | null = null;
const signedOutListeners = new Set<() => void>();

async function refreshSession(): Promise<Customer | null> {
  refreshing ??= api<TokenResponse>("/auth/refresh", { method: "POST" })
    .then((res) => {
      accessToken = res.access_token;
      return res.customer;
    })
    .catch(() => {
      accessToken = null;
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** Calls a customer endpoint with the signed-in token, refreshing once on a 401. */
export async function customerApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await api<T>(path, init, accessToken ?? undefined);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !hint.get()) throw error;
    if (!(await refreshSession())) {
      signedOutListeners.forEach((listener) => listener());
      throw error;
    }
    return api<T>(path, init, accessToken ?? undefined);
  }
}

/** The current token, for calls that work for guests too (checkout, print requests). */
export const customerToken = () => accessToken ?? undefined;

const toServer = (lines: BagLine[]) => ({ items: lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, qty: l.qty })) });
const fromServer = (b: ServerBag): BagLine[] => b.lines.map((l) => ({ productId: l.product_id, variantId: l.variant_id, qty: l.qty }));

/** Merges the guest bag into the account's bag after signing in. */
async function mergeBag() {
  const server = fromServer(await customerApi<ServerBag>("/cart"));
  const merged = [...server];
  for (const local of bag.snapshot()) {
    const same = merged.find((l) => l.productId === local.productId && l.variantId === local.variantId);
    if (same) same.qty = Math.min(99, Math.max(same.qty, local.qty));
    else merged.push(local);
  }
  const saved = fromServer(await customerApi<ServerBag>("/cart", { method: "PUT", body: JSON.stringify(toServer(merged)) }));
  bag.replace(saved, { silent: true });
}

type SessionState = {
  customer: Customer | null;
  status: "loading" | "signedIn" | "signedOut";
  login: (email: string, password: string) => Promise<void>;
  verify: (email: string, code: string) => Promise<Customer>;
  logout: () => Promise<void>;
  setCustomer: (c: Customer) => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function CustomerSessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [status, setStatus] = useState<SessionState["status"]>(hint.get() ? "loading" : "signedOut");

  const signOutLocally = useCallback(() => {
    accessToken = null;
    hint.set(false);
    setCustomer(null);
    setStatus("signedOut");
    queryClient.removeQueries({ queryKey: ["me"] });
  }, [queryClient]);

  const signedIn = useCallback(async (res: TokenResponse) => {
    accessToken = res.access_token;
    hint.set(true);
    setCustomer(res.customer);
    setStatus("signedIn");
    await mergeBag().catch(() => undefined);
    return res.customer;
  }, []);

  useEffect(() => {
    let active = true;
    if (hint.get()) {
      refreshSession().then(async (member) => {
        if (!active) return;
        if (member) {
          setCustomer(member);
          setStatus("signedIn");
          await mergeBag().catch(() => undefined);
        } else signOutLocally();
      });
    }
    signedOutListeners.add(signOutLocally);
    return () => {
      active = false;
      signedOutListeners.delete(signOutLocally);
    };
  }, [signOutLocally]);

  // While signed in, every bag change is saved to the account (after a short pause).
  useEffect(() => {
    if (status !== "signedIn") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onBagChange((lines) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        customerApi("/cart", { method: "PUT", body: JSON.stringify(toServer(lines)) }).catch(() => undefined);
      }, 400);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [status]);

  const value = useMemo<SessionState>(
    () => ({
      customer,
      status,
      login: async (email, password) => {
        await signedIn(await api<TokenResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
      },
      verify: async (email, code) =>
        signedIn(await api<TokenResponse>("/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) })),
      logout: async () => {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        // A shared phone or computer shouldn't keep the last customer's bag. Silent, so the account's
        // saved bag on the server isn't emptied too.
        bag.replace([], { silent: true });
        signOutLocally();
      },
      setCustomer,
    }),
    [customer, status, signedIn, signOutLocally],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useCustomerSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useCustomerSession must be used inside CustomerSessionProvider");
  return session;
}
