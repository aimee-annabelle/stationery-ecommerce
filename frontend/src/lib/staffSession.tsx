// Staff sign-in. The access token lives only in memory; the refresh token is an httpOnly cookie the
// browser sends to /api/v1/staff/auth. On a 401 the client refreshes once and retries.

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api";

export type Capability =
  | "orders.create"
  | "orders.update_status"
  | "payments.verify"
  | "orders.cancel"
  | "orders.refund"
  | "print_requests.manage"
  | "products.view"
  | "products.edit"
  | "stock.manage"
  | "costs.view"
  | "reports.view"
  | "activity.view"
  | "staff.manage"
  | "settings.manage";

export type StaffMember = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: "owner" | "manager" | "worker";
  capabilities: Capability[];
};

type TokenResponse = { access_token: string; staff: StaffMember };

let accessToken: string | null = null;
let refreshing: Promise<StaffMember | null> | null = null;
const signedOutListeners = new Set<() => void>();

async function refreshSession(): Promise<StaffMember | null> {
  // One refresh at a time: the refresh token changes on every use.
  refreshing ??= api<TokenResponse>("/staff/auth/refresh", { method: "POST" })
    .then((res) => {
      accessToken = res.access_token;
      return res.staff;
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

/** Calls a staff endpoint with the signed-in token. */
export async function staffApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await api<T>(path, init, accessToken ?? undefined);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (!(await refreshSession())) {
      signedOutListeners.forEach((listener) => listener());
      throw error;
    }
    return api<T>(path, init, accessToken ?? undefined);
  }
}

type SessionState = {
  staff: StaffMember | null;
  status: "loading" | "signedIn" | "signedOut";
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (capability: Capability) => boolean;
};

const SessionContext = createContext<SessionState | null>(null);

export function StaffSessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");

  const signOutLocally = useCallback(() => {
    accessToken = null;
    setStaff(null);
    setStatus("signedOut");
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    refreshSession().then((member) => {
      if (!active) return;
      setStaff(member);
      setStatus(member ? "signedIn" : "signedOut");
    });
    signedOutListeners.add(signOutLocally);
    return () => {
      active = false;
      signedOutListeners.delete(signOutLocally);
    };
  }, [signOutLocally]);

  const value = useMemo<SessionState>(
    () => ({
      staff,
      status,
      login: async (email, password) => {
        const res = await api<TokenResponse>("/staff/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        accessToken = res.access_token;
        setStaff(res.staff);
        setStatus("signedIn");
      },
      logout: async () => {
        await api("/staff/auth/logout", { method: "POST" }).catch(() => undefined);
        signOutLocally();
      },
      can: (capability) => !!staff?.capabilities.includes(capability),
    }),
    [staff, status, signOutLocally],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useStaffSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useStaffSession must be used inside StaffSessionProvider");
  return session;
}
