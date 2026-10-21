// Owner tools API: S5 reports, S6 activity, S7 team, S8 settings. Types mirror app/api/v1/staff_owner.py.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { staffApi, staffDownload } from "../../../lib/staffSession";

export type Report = {
  range: string;
  label: string;
  start: string;
  end: string;
  revenue_rwf: number;
  orders: number;
  average_order_rwf: number;
  print_jobs_completed: number;
  buckets: { label: string; start: string; end: string; revenue_rwf: number }[];
  categories: { name: string; tint: string; revenue_rwf: number; share: number | null }[];
  top_products: { name: string; units: number; revenue_rwf: number }[];
  staff: { name: string; role: string; orders_handled: number; print_jobs: number; sales_rwf: number }[];
};

export type ActivityEntry = {
  id: string;
  at: string;
  who: string;
  role: string;
  action: string;
  kind: string;
  kind_label: string;
  what: string;
  record: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  is_sensitive: boolean;
  device: string | null;
  reviewed_at: string | null;
};

export type ActivityFilters = { staff_id?: string; kind?: string; sensitive?: boolean; day?: string; page?: number };

export type Member = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: "owner" | "manager" | "worker";
  is_active: boolean;
  invite_pending: boolean;
  last_seen_at: string | null;
};

export type Settings = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const params = (values: Record<string, string | number | boolean | undefined>) => {
  const q = new URLSearchParams();
  Object.entries(values).forEach(([k, v]) => v !== undefined && v !== "" && v !== false && q.set(k, String(v)));
  return q.toString() ? `?${q}` : "";
};

export const useReport = (range: string) =>
  useQuery({ queryKey: ["staff", "reports", range], queryFn: () => staffApi<Report>(`/staff/reports?range=${range}`), placeholderData: keepPreviousData });

export const useActivity = (filters: ActivityFilters) =>
  useQuery({
    queryKey: ["staff", "activity", filters],
    queryFn: () =>
      staffApi<{ items: ActivityEntry[]; total: number; page: number; page_size: number; staff: { id: string; name: string; role: string }[] }>(
        `/staff/activity${params(filters)}`,
      ),
    placeholderData: keepPreviousData,
  });

export function useReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => staffApi(`/staff/activity/${id}/reviewed`, { method: "POST" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["staff", "dashboard"] });
      client.invalidateQueries({ queryKey: ["staff", "activity"] });
    },
  });
}

export const useTeam = () =>
  useQuery({ queryKey: ["staff", "team"], queryFn: () => staffApi<{ members: Member[]; permissions: Record<string, string[]> }>("/staff/team") });

function useTeamMutation<T, R>(request: (args: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: request, onSuccess: () => client.invalidateQueries({ queryKey: ["staff", "team"] }) });
}

export const useInvite = () =>
  useTeamMutation((body: { name: string; phone: string; email: string; role: string }) =>
    staffApi<{ member: Member; link: string }>("/staff/team/invite", json("POST", body)),
  );
export const useResendInvite = () =>
  useTeamMutation((id: string) => staffApi<{ member: Member; link: string }>(`/staff/team/${id}/invite`, { method: "POST" }));
export const useUpdateMember = () =>
  useTeamMutation(({ id, ...body }: { id: string; role?: string; is_active?: boolean }) =>
    staffApi<Member>(`/staff/team/${id}`, json("PATCH", body)),
  );

export const useSettings = () =>
  useQuery({ queryKey: ["staff", "settings"], queryFn: () => staffApi<{ settings: Settings; owner_email: string }>("/staff/settings") });

export function useSaveSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: Settings) => staffApi<{ settings: Settings; owner_email: string }>("/staff/settings", json("PATCH", changes)),
    onSuccess: (data) => {
      client.setQueryData(["staff", "settings"], data);
      client.invalidateQueries({ queryKey: ["shop", "settings"] });
    },
  });
}

/** Saves a download (report export, activity CSV) fetched with the staff token. */
export async function download(path: string, filename: string) {
  const url = URL.createObjectURL(await staffDownload(path));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export const query = params;
