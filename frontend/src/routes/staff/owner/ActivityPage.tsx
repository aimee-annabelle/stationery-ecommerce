// S6 · Activity log (design/AdminActivity.dc.html). Owner only. Read-only: there is no edit or delete.

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { icons } from "../../../components/icons";
import { Pager } from "../../../components/Pager";
import { strings } from "../../../strings";
import { type ActivityEntry, download, query, useActivity } from "./ownerApi";

const t = strings.activity;
const TINTS = ["bg-sage", "bg-butter", "bg-lilac", "bg-blush"];
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const dayLabel = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Kigali" }).format(new Date(iso));
const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kigali" }).format(new Date(iso));
const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join(", ") : String(v));
const chip = (on: boolean) => `min-h-10 cursor-pointer rounded-full px-3.5 text-[13px] font-semibold ${on ? "bg-ink text-white" : "border border-line bg-white"}`;

export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const filters = {
    staff_id: params.get("staff") ?? undefined,
    kind: params.get("kind") ?? undefined,
    sensitive: params.get("sensitive") === "1",
    day: params.get("day") ?? undefined,
    page: Math.max(1, Number(params.get("page")) || 1),
  };
  const log = useActivity(filters);
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next, { replace: true });
  };

  const groups: { day: string; items: ActivityEntry[] }[] = [];
  for (const item of log.data?.items ?? []) {
    const day = dayLabel(item.at);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(item);
  }
  const people = log.data?.staff ?? [];
  const tint = (who: string) => TINTS[Math.max(0, people.findIndex((p) => p.name === who)) % TINTS.length];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-3xl bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[60px] text-[13px] font-semibold text-muted">{t.staff}</span>
          <button type="button" aria-pressed={!filters.staff_id} onClick={() => set("staff", null)} className={chip(!filters.staff_id)}>{t.everyone}</button>
          {people.map((p) => (
            <button key={p.id} type="button" aria-pressed={filters.staff_id === p.id} onClick={() => set("staff", p.id)} className={chip(filters.staff_id === p.id)}>{p.name}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-[60px] text-[13px] font-semibold text-muted">{t.action}</span>
          <button type="button" aria-pressed={!filters.kind} onClick={() => set("kind", null)} className={chip(!filters.kind)}>{t.all}</button>
          {Object.entries(t.kinds).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filters.kind === id} onClick={() => set("kind", id)} className={chip(filters.kind === id)}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" aria-pressed={filters.sensitive} onClick={() => set("sensitive", filters.sensitive ? null : "1")} className={`flex min-h-[42px] cursor-pointer items-center gap-2 rounded-full px-4 text-[13px] font-semibold ${filters.sensitive ? "bg-terracotta text-white" : "border border-line bg-white"}`}>
              <icons.lock size={14} />
              {t.sensitiveOnly}
            </button>
            <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">
              {t.day}
              <input type="date" value={filters.day ?? ""} onChange={(e) => set("day", e.target.value || null)} className="min-h-10 rounded-xl border border-line px-2 text-sm text-ink" />
            </label>
          </div>
          <button
            type="button"
            onClick={() => download(`/staff/activity/export${query({ staff_id: filters.staff_id, kind: filters.kind, sensitive: filters.sensitive, day: filters.day })}`, "pahyems-activity.csv")}
            className="min-h-[42px] cursor-pointer rounded-full border border-ink bg-white px-4 text-[13px] font-semibold"
          >
            {t.export}
          </button>
        </div>
      </div>

      <div className="rounded-3xl bg-white px-5 pt-2 pb-4">
        {log.data && log.data.items.length === 0 && <div className="p-10 text-center text-muted">{t.empty}</div>}
        {groups.map((g) => (
          <div key={g.day} className="flex flex-col">
            <div className="pt-4 pb-1.5 text-xs font-bold tracking-[0.08em] text-muted uppercase">{g.day}</div>
            {g.items.map((a) => <Entry key={a.id} a={a} tint={tint(a.who)} />)}
          </div>
        ))}
        {log.data && (
          <Pager
            page={filters.page}
            pageSize={log.data.page_size}
            total={log.data.total}
            onPage={(page) => {
              const next = new URLSearchParams(params);
              if (page > 1) next.set("page", String(page));
              else next.delete("page");
              setParams(next);
            }}
          />
        )}
      </div>
    </>
  );
}

function Entry({ a, tint }: { a: ActivityEntry; tint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-paper-staff">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-[60px] w-full cursor-pointer items-center gap-3.5 py-2.5 text-left">
        <span className="w-[52px] shrink-0 text-[13px] text-muted">{clock(a.at)}</span>
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${tint}`}>{initials(a.who)}</span>
        <span className="flex-1 text-sm leading-normal">
          <strong className="font-semibold">{a.who}</strong> <span className="text-muted">({strings.staff.roles[a.role as "worker"]})</span> {a.what}
        </span>
        {a.is_sensitive && <span className="rounded-full bg-blush px-2.5 py-1 text-[11px] font-semibold">{t.sensitive}</span>}
        <span className="hidden rounded-full bg-paper px-2.5 py-1 text-[11px] font-semibold sm:inline">{a.kind_label}</span>
      </button>
      {open && (
        <div className="mb-3 ml-[66px] grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2 rounded-2xl bg-paper p-3.5 text-[13px]">
          <span><span className="block text-muted">{t.before}</span>{show(a.before)}</span>
          <span><span className="block text-muted">{t.after}</span>{show(a.after)}</span>
          <span><span className="block text-muted">{t.record}</span>{a.record ?? "—"}</span>
          <span className="break-all"><span className="block text-muted">{t.device}</span>{a.device ?? "—"}</span>
          {a.reviewed_at && <span><span className="block text-muted">{t.reviewed}</span>{clock(a.reviewed_at)}</span>}
        </div>
      )}
    </div>
  );
}
