// S8 · Shop settings (design/AdminSettings.dc.html). Owner only. Edits stay in a draft until "Save changes";
// the server checks each section and logs the change.

import { useEffect, useMemo, useState } from "react";
import { icons } from "../../../components/icons";
import { ApiError } from "../../../lib/api";
import { formatPhone } from "../../../lib/format";
import { strings } from "../../../strings";
import { type Settings, useSaveSettings, useSettings } from "./ownerApi";

const t = strings.settings;
type Section = "details" | "hours" | "payments" | "orders" | "receipts" | "alerts";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const field = "min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-medium";
const card = "flex flex-col gap-4 rounded-3xl bg-white p-6";
const h2 = "m-0 font-body text-lg font-bold";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`flex h-7 w-12 shrink-0 cursor-pointer rounded-full p-[3px] ${on ? "justify-end bg-[#3E6B52]" : "justify-start bg-[#C9C4B8]"}`}>
      <span className="block size-[22px] rounded-full bg-white" />
    </button>
  );
}

function SwitchRow({ label, note, on, onChange }: { label: string; note: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-paper-staff py-3 first-of-type:border-0">
      <span className="flex flex-col"><span className="text-[15px] font-semibold">{label}</span><span className="text-[13px] text-muted">{note}</span></span>
      <Switch on={on} onChange={onChange} label={label} />
    </div>
  );
}

export function SettingsPage() {
  const loaded = useSettings();
  const save = useSaveSettings();
  const [section, setSection] = useState<Section>("details");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (loaded.data && !draft) setDraft(clone(loaded.data.settings));
  }, [loaded.data, draft]);

  const original = loaded.data?.settings;
  const changed = useMemo(() => {
    if (!draft || !original) return {};
    return Object.fromEntries(Object.keys(draft).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(original[k])).map((k) => [k, draft[k]]));
  }, [draft, original]);
  const dirty = Object.keys(changed).length > 0;

  if (!draft || !loaded.data) return <p>{strings.staff.loading}</p>;
  const set = (key: string, value: unknown) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };
  const patch = (key: string, changes: Record<string, unknown>) => set(key, { ...draft[key], ...changes });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <nav aria-label={t.sectionsLabel} className="flex flex-[1_1_200px] flex-col gap-0.5 rounded-3xl bg-white p-2.5">
          {(Object.keys(t.sections) as Section[]).map((id) => (
            <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)} className={`flex min-h-14 cursor-pointer flex-col justify-center gap-0.5 rounded-2xl px-3.5 py-2 text-left text-sm font-semibold ${section === id ? "bg-sage" : ""}`}>
              <span>{t.sections[id][0]}</span>
              <span className="text-xs font-medium text-muted">{t.sections[id][1]}</span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
          {section === "details" && (
            <div className={card}>
              <h2 className={h2}>{t.sections.details[0]}</h2>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3.5">
                {(["name", "phone", "whatsapp", "email", "tin"] as const).map((k) => (
                  <label key={k} className="flex flex-col gap-1.5 text-[13px] font-semibold">
                    {t.shop[k]}
                    <input value={(k === "phone" || k === "whatsapp") && /^250\d{9}$/.test(draft.shop[k]) ? formatPhone(draft.shop[k]) : draft.shop[k] ?? ""} onChange={(e) => patch("shop", { [k]: e.target.value })} className={field} />
                  </label>
                ))}
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold sm:col-span-2">
                  {t.shop.address}
                  <input value={draft.shop.address ?? ""} onChange={(e) => patch("shop", { address: e.target.value })} className={field} />
                </label>
              </div>
            </div>
          )}

          {section === "hours" && (
            <div className={card}>
              <div><h2 className={h2}>{t.sections.hours[0]}</h2><p className="m-0 text-[13px] text-muted">{t.hoursIntro}</p></div>
              {DAYS.map((d) => {
                const day = draft.hours[d] ?? { open: "", close: "", closed: false };
                const time = (v: string) => (/^\d\d:\d\d$/.test(v) ? v : "");
                return (
                  <div key={d} className="flex flex-wrap items-center gap-3 border-t border-paper-staff pt-3 first-of-type:border-0">
                    <span className="w-28 text-[15px] font-semibold">{t.days[d]}</span>
                    {!day.closed && (
                      <>
                        <label><span className="sr-only">{t.opens(t.days[d])}</span><input type="time" value={time(day.open)} onChange={(e) => patch("hours", { [d]: { ...day, open: e.target.value } })} className={`${field} w-32`} /></label>
                        <span className="text-sm text-muted">{t.to}</span>
                        <label><span className="sr-only">{t.closes(t.days[d])}</span><input type="time" value={time(day.close)} onChange={(e) => patch("hours", { [d]: { ...day, close: e.target.value } })} className={`${field} w-32`} /></label>
                      </>
                    )}
                    <span className="ml-auto flex items-center gap-2 text-sm">{t.closed}<Switch on={day.closed} label={`${t.days[d]}: ${t.closed}`} onChange={(v) => patch("hours", { [d]: { ...day, closed: v } })} /></span>
                  </div>
                );
              })}
              <div className="flex flex-col gap-2 rounded-2xl bg-paper p-4">
                <span className="text-sm">{t.closuresIntro}</span>
                <div className="flex flex-wrap gap-2">
                  {(draft.closures as string[]).map((d) => (
                    <span key={d} className="flex items-center gap-1 rounded-full bg-white py-1 pr-1 pl-3 text-sm">
                      {d}
                      <button type="button" aria-label={t.removeClosure(d)} onClick={() => set("closures", draft.closures.filter((x: string) => x !== d))} className="flex size-8 cursor-pointer items-center justify-center rounded-full"><icons.close size={12} /></button>
                    </span>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[13px] font-semibold">
                  {t.addClosure}
                  <input type="date" onChange={(e) => e.target.value && set("closures", Array.from(new Set([...draft.closures, e.target.value])).sort())} className="min-h-10 rounded-xl border border-line px-2 text-sm" />
                </label>
              </div>
            </div>
          )}

          {section === "payments" && (
            <div className={card}>
              <h2 className={h2}>{t.sections.payments[0]}</h2>
              {(["momo", "airtel", "pay_at_pickup"] as const).map((m) => {
                const [label, note, codeLabel] = t.pay[m];
                const method = draft.payment_methods[m];
                return (
                  <div key={m} className="flex flex-col gap-2.5 border-t border-paper-staff pt-3 first-of-type:border-0">
                    <SwitchRow label={label} note={note} on={method.enabled} onChange={(v) => patch("payment_methods", { [m]: { ...method, enabled: v } })} />
                    {codeLabel && method.enabled && (
                      <label className="flex max-w-[320px] flex-col gap-1.5 text-[13px] font-semibold">{codeLabel}<input value={method.merchant_code ?? ""} onChange={(e) => patch("payment_methods", { [m]: { ...method, merchant_code: e.target.value } })} className={field} /></label>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {section === "orders" && (
            <>
              <div className={card}>
                <h2 className={h2}>{t.sections.orders[0]}</h2>
                {(["allow_guest_checkout", "whatsapp_ready_button"] as const).map((k) => (
                  <SwitchRow key={k} label={t.orders[k][0]} note={t.orders[k][1]} on={draft.orders[k]} onChange={(v) => patch("orders", { [k]: v })} />
                ))}
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
                  <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.holdDays}<input type="number" min={1} max={30} value={draft.orders.pickup_hold_days} onChange={(e) => patch("orders", { pickup_hold_days: Number(e.target.value) })} className={field} /></label>
                  <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.defaultAlert}<input type="number" min={0} value={draft.orders.default_low_stock_alert} onChange={(e) => patch("orders", { default_low_stock_alert: Number(e.target.value) })} className={field} /></label>
                </div>
              </div>
              <div className={card}>
                <div><h2 className={h2}>{t.messages}</h2><p className="m-0 text-[13px] text-muted">{t.messagesNote}</p></div>
                {Object.keys(t.templates).map((k) => (
                  <label key={k} className="flex flex-col gap-1.5 text-[13px] font-semibold">
                    {t.templates[k]}
                    <textarea rows={2} value={draft.message_templates[k] ?? ""} onChange={(e) => patch("message_templates", { [k]: e.target.value })} className="w-full rounded-xl border border-line px-3.5 py-3 text-sm font-medium" />
                  </label>
                ))}
              </div>
            </>
          )}

          {section === "receipts" && (
            <div className="flex flex-wrap items-start gap-4">
              <div className={`${card} flex-[1_1_320px]`}>
                <h2 className={h2}>{t.sections.receipts[0]}</h2>
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.receipt.footer}<input value={draft.receipt.footer} onChange={(e) => patch("receipt", { footer: e.target.value })} className={field} /></label>
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.receipt.returns_policy}<textarea rows={2} value={draft.receipt.returns_policy} onChange={(e) => patch("receipt", { returns_policy: e.target.value })} className="w-full rounded-xl border border-line px-3.5 py-3 text-sm" /></label>
                <SwitchRow label={t.receipt.show_tin} note="" on={draft.receipt.show_tin} onChange={(v) => patch("receipt", { show_tin: v })} />
                <SwitchRow label={t.receipt.email_after_payment} note="" on={draft.receipt.email_after_payment} onChange={(v) => patch("receipt", { email_after_payment: v })} />
              </div>
              <div className="flex-[0_1_300px] rounded-3xl bg-white p-6" aria-label={t.preview}>
                <div className="mx-auto max-w-[260px] rounded-lg border border-dashed border-line bg-paper p-4 font-mono text-[11px] leading-relaxed">
                  <div className="text-center font-bold">{String(draft.shop.name).toUpperCase()}</div>
                  <div className="text-center">{draft.shop.address}</div>
                  <div className="text-center">Tel {/^250\d{9}$/.test(draft.shop.phone) ? formatPhone(draft.shop.phone) : draft.shop.phone}</div>
                  {draft.receipt.show_tin && <div className="text-center">TIN {draft.shop.tin}</div>}
                  <hr className="my-2 border-dashed" />
                  <div>2 × Notebook A4 <span className="float-right">5,000</span></div>
                  <div>1 × Pens (10) <span className="float-right">3,000</span></div>
                  <hr className="my-2 border-dashed" />
                  <div className="font-bold">TOTAL RWF <span className="float-right">8,000</span></div>
                  <div>Paid: Cash</div>
                  <hr className="my-2 border-dashed" />
                  <div className="text-center">{draft.receipt.footer}</div>
                  <div className="text-center text-[10px]">{draft.receipt.returns_policy}</div>
                </div>
              </div>
            </div>
          )}

          {section === "alerts" && (
            <div className={card}>
              <div><h2 className={h2}>{t.sections.alerts[0]}</h2><p className="m-0 text-[13px] text-muted">{t.alertsTo(draft.owner_alerts.email || loaded.data.owner_email)}</p></div>
              <label className="flex max-w-[420px] flex-col gap-1.5 text-[13px] font-semibold">
                {t.alertsEmail}
                <input type="email" value={draft.owner_alerts.email ?? ""} onChange={(e) => patch("owner_alerts", { email: e.target.value })} placeholder={loaded.data.owner_email} className={field} />
                <span className="text-xs font-normal text-muted">{t.alertsEmailHint(loaded.data.owner_email)}</span>
              </label>
              {Object.keys(t.alerts).map((k) => (
                <SwitchRow key={k} label={t.alerts[k][0]} note={t.alerts[k][1]} on={!!draft.owner_alerts[k]} onChange={(v) => patch("owner_alerts", { [k]: v })} />
              ))}
              <label className="flex max-w-[200px] flex-col gap-1.5 text-[13px] font-semibold">{t.dailyTime}<input type="time" value={draft.owner_alerts.daily_time} onChange={(e) => patch("owner_alerts", { daily_time: e.target.value })} className={field} /></label>
            </div>
          )}

          {saved && !dirty && <p role="status" className="m-0 rounded-2xl bg-sage px-4 py-3 text-sm">{t.saved}</p>}
          {save.error && <p role="alert" className="m-0 rounded-2xl bg-blush px-4 py-3 text-sm text-error">{save.error instanceof ApiError ? save.error.message : strings.genericError}</p>}
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-[96px] z-[5] mt-4 flex flex-wrap items-center justify-between gap-3 rounded-full bg-ink py-2 pr-2 pl-6 text-white shadow-[0_12px_32px_rgba(34,48,42,0.25)] md:bottom-4">
          <span role="status" className="text-sm font-medium">{t.unsaved}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => { if (original) setDraft(clone(original)); save.reset(); }} className="min-h-11 cursor-pointer rounded-full border border-white/40 px-[18px] text-sm font-semibold">{t.discard}</button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate(changed, { onSuccess: (data) => { setDraft(clone(data.settings)); setSaved(true); } })}
              className="min-h-11 cursor-pointer rounded-full bg-sage px-5 text-sm font-semibold text-ink"
            >
              {t.save}
            </button>
          </span>
        </div>
      )}
    </>
  );
}
