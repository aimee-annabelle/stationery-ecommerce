// S5 · Reports (design/AdminReports.dc.html). Owner only (reports.view).

import { useState } from "react";
import { Link } from "react-router-dom";
import { formatRwf } from "../../../lib/format";
import { strings } from "../../../strings";
import { download, useReport } from "./ownerApi";

const t = strings.reports;
const TINT: Record<string, string> = { butter: "bg-butter", lilac: "bg-lilac", blush: "bg-blush", sage: "bg-sage" };
const card = "flex flex-col gap-4 rounded-3xl bg-white p-6";
const h2 = "m-0 font-body text-lg font-bold";
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function ReportsPage() {
  const [range, setRange] = useState("7d");
  const [busy, setBusy] = useState<string | null>(null);
  const report = useReport(range);
  const r = report.data;
  const max = Math.max(1, ...(r?.buckets.map((b) => b.revenue_rwf) ?? [1]));

  const exportAs = async (format: "xlsx" | "pdf") => {
    setBusy(format);
    try {
      await download(`/staff/reports/export?range=${range}&format=${format}`, `pahyems-report-${range}.${format}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t.rangeLabel} className="flex gap-1.5 rounded-full bg-white p-[5px]">
          {Object.entries(t.ranges).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={range === id} onClick={() => setRange(id)} className={`min-h-[42px] cursor-pointer rounded-full px-4 text-[13px] font-semibold ${range === id ? "bg-ink text-white" : ""}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" disabled={!!busy} onClick={() => exportAs("xlsx")} className="min-h-[46px] cursor-pointer rounded-full border border-ink bg-white px-5 text-sm font-semibold disabled:opacity-50">{t.excel}</button>
          <button type="button" disabled={!!busy} onClick={() => exportAs("pdf")} className="min-h-[46px] cursor-pointer rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50">{t.pdf}</button>
        </div>
      </div>
      {r && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3.5">
            {[
              [t.kpis.revenue, formatRwf(r.revenue_rwf)],
              [t.kpis.orders, r.orders.toLocaleString("en-US")],
              [t.kpis.average, formatRwf(r.average_order_rwf)],
              [t.kpis.jobs, r.print_jobs_completed.toLocaleString("en-US")],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-2.5 rounded-3xl bg-white p-[22px]">
                <span className="text-sm text-muted">{label}</span>
                <span className="text-[28px] font-bold tracking-[-0.02em]">{value}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            <div className={`${card} flex-[2_1_480px]`}>
              <h2 className={h2}>{t.revenue(r.label)}</h2>
              <div className="relative flex h-[220px] items-end gap-2 border-b border-[#EEEBE4] pl-10">
                <span className="absolute top-0 left-0 text-xs text-muted">{compact(max)}</span>
                <span className="absolute top-1/2 left-0 text-xs text-muted">{compact(Math.round(max / 2))}</span>
                {r.buckets.map((b) => (
                  <div key={b.start} className="group relative flex h-full flex-1 items-end">
                    <span className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2 py-1 text-xs whitespace-nowrap text-white group-focus-within:block group-hover:block">{formatRwf(b.revenue_rwf)}</span>
                    <button type="button" aria-label={`${b.label}: ${formatRwf(b.revenue_rwf)}`} className="w-full cursor-default rounded-t-xl bg-sage hover:bg-ink" style={{ height: `${Math.max(1, (b.revenue_rwf / max) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pl-10">
                {r.buckets.map((b) => <span key={b.start} className="flex-1 truncate text-center text-xs text-muted">{b.label}</span>)}
              </div>
              <p className="m-0 text-xs text-muted">{t.revenueNote}</p>
            </div>
            <div className={`${card} flex-[1_1_300px]`}>
              <h2 className={h2}>{t.byCategory}</h2>
              {r.categories.length === 0 && <p className="m-0 text-sm text-muted">{t.none}</p>}
              {r.categories.map((c) => (
                <div key={c.name} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{c.name} {c.share != null && <span className="text-muted">{c.share}%</span>}</span>
                    <span className="font-semibold">{formatRwf(c.revenue_rwf)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-[#EEEBE4]">
                    <div className={`h-full ${TINT[c.tint] ?? "bg-sage"}`} style={{ width: `${Math.max(4, (c.revenue_rwf / Math.max(1, r.revenue_rwf)) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className={`${card} flex-[1_1_320px]`}>
              <h2 className={h2}>{t.top}</h2>
              <table className="w-full border-collapse text-sm">
                <thead><tr className="text-left text-xs tracking-[0.06em] text-muted uppercase"><th className="py-2 font-semibold">{t.product}</th><th className="py-2 text-right font-semibold">{t.units}</th><th className="py-2 text-right font-semibold">{t.rev}</th></tr></thead>
                <tbody>
                  {r.top_products.map((p) => (
                    <tr key={p.name} className="border-t border-paper-staff"><td className="py-2.5 font-medium">{p.name}</td><td className="py-2.5 text-right">{p.units}</td><td className="py-2.5 text-right font-semibold whitespace-nowrap">{formatRwf(p.revenue_rwf)}</td></tr>
                  ))}
                </tbody>
              </table>
              {r.top_products.length === 0 && <p className="m-0 text-sm text-muted">{t.none}</p>}
            </div>
            <div className={`${card} flex-[2_1_480px] overflow-x-auto`}>
              <div className="flex items-baseline justify-between">
                <h2 className={h2}>{t.staff}</h2>
                <Link to="/staff/activity" className="text-[13px] font-semibold underline">{t.everyAction}</Link>
              </div>
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead><tr className="text-left text-xs tracking-[0.06em] text-muted uppercase">{Object.values(t.cols).map((c) => <th key={c} className="py-2 font-semibold">{c}</th>)}</tr></thead>
                <tbody>
                  {r.staff.map((s) => (
                    <tr key={s.name} className="border-t border-paper-staff">
                      <td className="py-2.5"><span className="font-semibold">{s.name}</span> <span className="text-muted">{strings.staff.roles[s.role as "worker"]}</span></td>
                      <td className="py-2.5">{s.orders_handled}</td>
                      <td className="py-2.5">{s.print_jobs}</td>
                      <td className="py-2.5 font-semibold whitespace-nowrap">{formatRwf(s.sales_rwf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
