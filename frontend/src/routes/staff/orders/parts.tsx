// Order pieces shared by S2 (desktop panel), M2 (phone page) and the dashboards.

import { useState } from "react";
import { icons } from "../../../components/icons";
import { ApiError } from "../../../lib/api";
import { formatRwf } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staffSession";
import { strings } from "../../../strings";
import { type OrderDetail, type OrderStatus, useAdvance, useCancel, useVerify, useWhatsApp } from "./ordersApi";

const t = strings.orders;

export const PILL_BG: Record<OrderStatus, string> = {
  new: "bg-lilac",
  preparing: "bg-butter",
  ready: "bg-sage",
  collected: "bg-[#EEEBE4]",
  cancelled: "bg-blush",
};

export function StatusPill({ status, expired = false }: { status: OrderStatus; expired?: boolean }) {
  return (
    <span className={`rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap ${expired ? "bg-error text-white" : PILL_BG[status]}`}>
      {expired ? t.expired : t.status[status]}
    </span>
  );
}

export const errorText = (error: unknown) =>
  error ? (error instanceof ApiError ? error.message : strings.genericError) : null;

const time = (iso: string) => {
  const d = new Date(iso);
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali" }).format(d) ===
    new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali" }).format(new Date());
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kigali",
    ...(sameDay ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  }).format(d);
};
export const placedLabel = (order: { source: string; placed_at: string }) =>
  `${t.source[order.source as "online" | "walk_in"]} · ${time(order.placed_at)}`;

export function History({ order, compact = false }: { order: OrderDetail; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t.history}</span>
      {order.history.map((h, i) => {
        const step = t.historyStep[h.event ?? h.status] ?? h.status;
        const detail = h.event === "payment_sent" || h.event === "payment_rejected" ? h.note : h.status === "cancelled" && !h.event ? h.note : null;
        return compact ? (
          <span key={i} className="flex justify-between gap-3 text-[13px]">
            <span>
              <strong className="font-semibold">{step}</strong> · {h.who}
              {detail && <span className="text-muted"> · {detail}</span>}
            </span>
            <span className="whitespace-nowrap text-muted">{time(h.at)}</span>
          </span>
        ) : (
          <div key={i} className="flex items-start gap-3 py-2">
            <span className="mt-[5px] size-2.5 shrink-0 rounded-full bg-ink" />
            <span className="flex-1 text-sm">
              <span className="font-semibold">{step}</span> <span className="text-muted">{t.by(h.who)}</span>
              {detail && <span className="block text-[13px] text-muted">{detail}</span>}
            </span>
            <span className="text-xs whitespace-nowrap text-muted">{time(h.at)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "Check this MoMo payment" with Mark as paid / Not found (S2, M2). */
export function VerifyBox({ order }: { order: OrderDetail }) {
  const verify = useVerify();
  if (order.payment_status !== "awaiting_verification") return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-butter p-3.5 text-sm">
      <span className="font-semibold">{t.checkPayment}</span>
      <span>{t.txn(order.transaction_id ?? "—", formatRwf(order.total_rwf))}</span>
      <span className="text-[13px] text-[#3C4A42]">{t.checkHint}</span>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={verify.isPending}
          onClick={() => verify.mutate({ id: order.id, found: true })}
          className="min-h-11 flex-1 cursor-pointer rounded-full bg-ink text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {t.markPaid}
        </button>
        <button
          type="button"
          disabled={verify.isPending}
          onClick={() => verify.mutate({ id: order.id, found: false })}
          className="min-h-11 flex-1 cursor-pointer rounded-full border border-error bg-white text-[13px] font-semibold text-error disabled:opacity-50"
        >
          {t.notFound}
        </button>
      </span>
      {verify.error && <span role="alert" className="text-error">{errorText(verify.error)}</span>}
    </div>
  );
}

/** The WhatsApp button that fits the order's state. */
export function WhatsAppButton({ order, className = "" }: { order: OrderDetail; className?: string }) {
  const whatsapp = useWhatsApp();
  if (!order.phone || order.status === "cancelled") return null;
  if (order.prefers_call) {
    // The customer turned off WhatsApp updates in their account.
    return (
      <a href={`tel:+250${order.phone.replace(/\D/g, "").slice(1)}`} className={`flex min-h-12 items-center justify-center gap-2 rounded-full bg-sage text-sm font-semibold no-underline ${className}`}>
        <icons.phone size={16} />
        {t.prefersCall}
      </a>
    );
  }
  const [template, label] =
    order.status === "ready"
      ? (["ready", t.whatsappReady] as const)
      : order.payment_status === "rejected"
        ? (["payment_rejected", t.whatsappRejected] as const)
        : (["general", t.whatsappGeneral] as const);
  return (
    <button
      type="button"
      onClick={() => whatsapp.mutate({ id: order.id, template })}
      className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-sage text-sm font-semibold ${className}`}
    >
      <icons.phone size={16} />
      {label}
    </button>
  );
}

/** The next-step button, with the Cash / Mobile Money choice when a pay-at-pickup order is collected. */
export function AdvanceButton({ order, className = "", onDone }: { order: OrderDetail; className?: string; onDone?: () => void }) {
  const advance = useAdvance();
  const [choosing, setChoosing] = useState(false);
  const next = t.next[order.status];
  if (!next) return null;

  const unpicked = order.status === "preparing" && order.line_items.some((i) => !i.picked);
  const needsPaidWith = order.status === "ready" && order.payment_status !== "paid" && order.payment_method === "pay_at_pickup";
  const go = (paid_with?: "cash" | "mobile_money") =>
    advance.mutate({ id: order.id, paid_with }, { onSuccess: () => { setChoosing(false); onDone?.(); } });

  return (
    <div className="flex flex-col gap-1.5">
      {choosing ? (
        <div className="flex flex-col gap-2">
          <span className="text-center text-sm font-semibold">{t.collectHow}</span>
          <div className="flex gap-2">
            {(["cash", "mobile_money"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={advance.isPending}
                onClick={() => go(m)}
                className="min-h-[50px] flex-1 cursor-pointer rounded-full bg-ink text-[15px] font-semibold text-white disabled:opacity-50"
              >
                {m === "cash" ? t.cash : t.mobileMoney}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={unpicked || advance.isPending}
          onClick={() => (needsPaidWith ? setChoosing(true) : go())}
          className={`min-h-[50px] cursor-pointer rounded-full text-[15px] font-semibold text-white ${unpicked ? "bg-[#C9C4B8]" : "bg-ink"} ${className}`}
        >
          {next}
        </button>
      )}
      {unpicked && <span className="text-center text-xs text-muted">{t.pickNeeded}</span>}
      {advance.error && <span role="alert" className="text-center text-sm text-error">{errorText(advance.error)}</span>}
    </div>
  );
}

/** Cancel order with a reason, and refund confirmation for paid orders. Workers see why they can't. */
export function CancelControl({ order }: { order: OrderDetail }) {
  const { can } = useStaffSession();
  const cancel = useCancel();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [refunded, setRefunded] = useState(false);
  if (!["new", "preparing", "ready"].includes(order.status)) return null;
  if (!can("orders.cancel")) {
    return (
      <span className="flex items-center gap-2 text-[13px] text-muted">
        <icons.lock size={14} />
        {t.cancelLocked}
      </span>
    );
  }
  const paid = order.payment_status === "paid";
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[46px] cursor-pointer rounded-full border border-error bg-white text-sm font-semibold text-error"
      >
        {t.cancel}
      </button>
    );
  }
  return (
    <form
      className="flex flex-col gap-2.5 rounded-2xl border border-error p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        cancel.mutate({ id: order.id, reason, refund_confirmed: refunded }, { onSuccess: () => setOpen(false) });
      }}
    >
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        {t.cancelReason}
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t.cancelReasonPlaceholder}
          required
          className="min-h-11 rounded-xl border border-line px-3 text-sm font-medium"
        />
      </label>
      {paid && (
        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" checked={refunded} onChange={(e) => setRefunded(e.target.checked)} className="size-5 accent-ink" />
          {t.refundConfirm(formatRwf(order.total_rwf))}
        </label>
      )}
      {cancel.error && <span role="alert" className="text-sm text-error">{errorText(cancel.error)}</span>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 flex-1 cursor-pointer rounded-full border border-line bg-white text-sm font-semibold">
          {t.keep}
        </button>
        <button
          type="submit"
          disabled={cancel.isPending || !reason.trim() || (paid && !refunded)}
          className="min-h-11 flex-1 cursor-pointer rounded-full bg-error text-sm font-semibold text-white disabled:opacity-50"
        >
          {t.confirmCancel}
        </button>
      </div>
    </form>
  );
}
