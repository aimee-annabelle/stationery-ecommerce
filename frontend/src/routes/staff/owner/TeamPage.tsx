// S7 · Staff & roles (design/AdminStaff.dc.html). Owner only. The permission table comes from the server's
// capability list, so it always matches what the API enforces.

import { useState } from "react";
import { icons } from "../../../components/icons";
import { ApiError } from "../../../lib/api";
import { strings } from "../../../strings";
import { type Member, useInvite, useResendInvite, useTeam, useUpdateMember } from "./ownerApi";
import { Select } from "../../../components/Select";

const t = strings.team;
const TINTS = ["bg-blush", "bg-butter", "bg-sage", "bg-lilac"];
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? strings.genericError : null);
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const lastSeen = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : t.never;

// Rows of the spec's permission table, each tied to the capabilities that implement it.
const ROWS: [string, string[], string?][] = [
  ["Create orders and walk-in sales", ["orders.create"]],
  ["Update order status", ["orders.update_status"]],
  ["Mark a MoMo / Airtel payment as verified", ["payments.verify"]],
  ["Cancel orders and give refunds", ["orders.cancel", "orders.refund"]],
  ["Add and handle print requests, send quotes", ["print_requests.manage"]],
  ["See products and stock levels", ["products.view"], "products.edit"],
  ["Add or edit products and prices", ["products.edit"]],
  ["Receive and adjust stock", ["stock.manage"]],
  ["See cost prices and margins", ["costs.view"]],
  ["Reports and exports", ["reports.view"]],
  ["Activity log (who did what)", ["activity.view"]],
  ["Add staff and change roles", ["staff.manage"]],
  ["Shop settings (hours, payments, receipts, alerts)", ["settings.manage"]],
];

export function TeamPage() {
  const team = useTeam();
  const update = useUpdateMember();
  const resend = useResendInvite();
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const members = team.data?.members ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-3xl bg-white p-2">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs tracking-[0.06em] text-muted uppercase">
              {Object.values(t.cols).map((c) => <th key={c} className="px-4 py-3.5 font-semibold">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {members.map((m, i) => (
              <Row key={m.id} m={m} tint={TINTS[i % TINTS.length]} busy={update.isPending || resend.isPending}
                onRole={(role) => update.mutate({ id: m.id, role })}
                onAccess={() => (m.is_active ? window.confirm(t.confirmRemove(m.name)) : true) && update.mutate({ id: m.id, is_active: !m.is_active })}
                onResend={() => resend.mutate(m.id, { onSuccess: (r) => setLink({ name: r.member.name, url: r.link }) })}
              />
            ))}
          </tbody>
        </table>
        {(update.error || resend.error) && <p role="alert" className="m-0 px-4 pb-3 text-sm text-error">{errorText(update.error || resend.error)}</p>}
      </div>
      {link && <InviteLink name={link.name} url={link.url} onClose={() => setLink(null)} />}
      <div className="flex flex-wrap items-start gap-4">
        <AddMember onInvited={(name, url) => setLink({ name, url })} />
        <div className="flex flex-[2_1_480px] flex-col gap-3 overflow-x-auto rounded-3xl bg-white p-6">
          <h2 className="m-0 font-body text-lg font-bold">{t.whatEach}</h2>
          <p className="m-0 text-[13px] text-muted">{t.logged}</p>
          <table className="w-full min-w-[440px] border-collapse text-sm">
            <thead><tr className="text-left text-xs tracking-[0.06em] text-muted uppercase"><th className="py-2 font-semibold">{t.permission}</th><th className="py-2 font-semibold">{t.owner}</th><th className="py-2 font-semibold">{t.manager}</th><th className="py-2 font-semibold">{t.worker}</th></tr></thead>
            <tbody>
              {ROWS.map(([label, caps, editCap]) => (
                <tr key={label} className="border-t border-paper-staff">
                  <td className="py-2.5 pr-3">{label}</td>
                  {(["owner", "manager", "worker"] as const).map((role) => {
                    const has = caps.every((c) => team.data?.permissions[role]?.includes(c));
                    // "View only" when they can see products but not change them.
                    const viewOnly = has && editCap && !team.data?.permissions[role]?.includes(editCap);
                    return (
                      <td key={role} className="py-2.5">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${viewOnly ? "bg-butter" : has ? "bg-sage" : "bg-paper-staff text-muted"}`}>
                          {viewOnly ? t.view : has ? t.yes : t.no}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Row({ m, tint, busy, onRole, onAccess, onResend }: { m: Member; tint: string; busy: boolean; onRole: (r: string) => void; onAccess: () => void; onResend: () => void }) {
  const owner = m.role === "owner";
  return (
    <tr className={`border-t border-paper-staff ${m.is_active ? "" : "opacity-60"}`}>
      <td className="px-4 py-3">
        <span className="flex items-center gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${tint}`}>{initials(m.name)}</span>
          <span className="flex flex-col"><span className="font-semibold">{m.name}</span><span className="text-xs text-muted">{m.phone} · {m.email}</span></span>
        </span>
      </td>
      <td className="px-4 py-3">
        {owner ? (
          <span className="rounded-full bg-blush px-3 py-1.5 text-xs font-semibold">{t.owner}</span>
        ) : (
          <label>
            <span className="sr-only">{t.roleFor(m.name)}</span>
            <Select
              value={m.role}
              disabled={busy || !m.is_active}
              onChange={onRole}
              options={[{ value: "manager", label: t.manager }, { value: "worker", label: t.worker }]}
              className="min-h-10 min-w-[136px] rounded-xl border border-line bg-white px-3.5 text-sm font-medium"
            />
          </label>
        )}
      </td>
      <td className="px-4 py-3 text-muted">
        {!m.is_active ? t.removed : m.invite_pending ? <button type="button" onClick={onResend} disabled={busy} className="cursor-pointer text-left text-[13px] underline">{t.invited} · {t.resend}</button> : lastSeen(m.last_seen_at)}
      </td>
      <td className="px-4 py-3">
        {owner ? (
          <span className="text-[13px] text-muted">{t.fullAccess}</span>
        ) : (
          <button type="button" disabled={busy} onClick={onAccess} className={`min-h-[38px] cursor-pointer rounded-full px-3.5 text-xs font-semibold ${m.is_active ? "border border-[#E8B7A8] bg-white text-error" : "border border-ink bg-ink text-white"}`}>
            {m.is_active ? t.remove : t.restore}
          </button>
        )}
      </td>
    </tr>
  );
}

function AddMember({ onInvited }: { onInvited: (name: string, url: string) => void }) {
  const invite = useInvite();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "worker">("worker");
  const [tried, setTried] = useState(false);
  const ok = name.trim().length > 1 && phone.replace(/\D/g, "").length >= 9 && /@/.test(email);
  const field = "min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-medium";
  return (
    <form
      className="flex flex-[1_1_320px] flex-col gap-3.5 rounded-3xl bg-white p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (ok) invite.mutate({ name, phone, email, role }, { onSuccess: (r) => { onInvited(r.member.name, r.link); setName(""); setPhone(""); setEmail(""); setTried(false); } });
      }}
    >
      <h2 className="m-0 font-body text-lg font-bold">{t.add}</h2>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.name}<input value={name} onChange={(e) => setName(e.target.value)} className={field} /></label>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.phone}<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07X XXX XXXX" className={field} /></label>
      <fieldset className="m-0 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-semibold">{t.role}</legend>
        <div role="radiogroup" className="flex gap-2">
          {(["manager", "worker"] as const).map((r) => (
            <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)} className={`min-h-[42px] flex-1 cursor-pointer rounded-full text-[13px] font-semibold ${role === r ? "border border-ink bg-ink text-white" : "border border-line bg-white"}`}>
              {r === "manager" ? t.manager : t.worker}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.email}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} /></label>
      <p className="m-0 text-xs text-muted">{t.inviteNote}</p>
      {tried && !ok && <p role="alert" className="m-0 text-sm text-error">{t.missing}</p>}
      {invite.error && <p role="alert" className="m-0 text-sm text-error">{errorText(invite.error)}</p>}
      <button type="submit" disabled={invite.isPending} className="min-h-[46px] cursor-pointer rounded-full bg-ink text-sm font-semibold text-white">{t.send}</button>
    </form>
  );
}

function InviteLink({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="flex flex-col gap-3 rounded-3xl border-2 border-ink bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="m-0 font-body text-lg font-bold">{t.linkTitle}</h2>
        <button type="button" aria-label={strings.products.form.close} onClick={onClose} className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-paper-staff"><icons.close size={14} /></button>
      </div>
      <p className="m-0 text-sm text-muted">{t.linkNote(name)}</p>
      <code className="rounded-xl bg-paper p-3 text-xs break-all">{url}</code>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))} className="min-h-11 cursor-pointer rounded-full bg-ink px-5 text-sm font-semibold text-white">{copied ? t.copied : t.copy}</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(url)}`} target="_blank" rel="noopener" className="flex min-h-11 items-center rounded-full bg-sage px-5 text-sm font-semibold no-underline">{t.shareWhatsapp}</a>
      </div>
    </div>
  );
}
