// S2 · Orders (design/AdminOrders.dc.html) and, on a phone, the order list and M2 order detail
// (design/MobileOrder.dc.html). /staff/orders/:id opens the detail panel on desktop and M2 on a phone.

import { useDeferredValue, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { icons } from "../../../components/icons";
import { Pager } from "../../../components/Pager";
import { formatRwf } from "../../../lib/format";
import { useIsPhone } from "../../../lib/useMediaQuery";
import { usePage } from "../../../lib/usePage";
import { strings } from "../../../strings";
import { type OrderDetail, type OrderRow, useOrder, useOrders, usePick } from "./ordersApi";
import { AdvanceButton, CancelControl, errorText, History, placedLabel, StatusPill, VerifyBox, WhatsAppButton } from "./parts";
import { WalkInPanel } from "./SalePage";

const t = strings.orders;
const FILTERS = ["", "new", "preparing", "ready", "collected", "cancelled", "expired"] as const;

export function OrdersPage() {
  const { orderId } = useParams();
  const isPhone = useIsPhone();
  if (isPhone) return orderId ? <MobileOrder id={orderId} /> : <MobileOrderList />;
  return <DesktopOrders selectedId={orderId} />;
}

function DesktopOrders({ selectedId }: { selectedId?: string }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("");
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [showNew, setShowNew] = useState(false);
  const [page, setPage] = usePage(`${filter}|${query}`);
  const orders = useOrders({ status: filter || undefined, q: query || undefined, page });
  const counts = orders.data?.counts ?? {};
  const allCount = Object.entries(counts).filter(([k]) => k !== "expired").reduce((s, [, n]) => s + n, 0);
  const select = (id: string) => navigate(`/staff/orders/${id}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t.tabsLabel} className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f || "all"}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-[42px] cursor-pointer rounded-full px-4 text-[13px] font-semibold ${filter === f ? (f === "expired" ? "bg-error text-white" : "bg-ink text-white") : "bg-white"}`}
            >
              {t.tabs[(f || "all") as keyof typeof t.tabs]} <span className="opacity-75">{f ? counts[f] ?? 0 : allCount}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2.5">
          <label className="flex min-h-[46px] items-center gap-2 rounded-full bg-white px-4 text-muted focus-within:outline-2 focus-within:outline-ink">
            <icons.search size={16} />
            <span className="sr-only">{t.search}</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} className="min-h-10 w-[220px] bg-transparent text-sm text-ink outline-none" />
          </label>
          <button type="button" onClick={() => setShowNew(!showNew)} className="flex min-h-[46px] cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white">
            <icons.plus size={16} />
            {t.newWalkIn}
          </button>
        </div>
      </div>

      {showNew && (
        <WalkInPanel
          onClose={() => setShowNew(false)}
          onCreated={(order) => {
            setShowNew(false);
            select(order.id);
          }}
        />
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[2_1_620px] overflow-x-auto rounded-3xl bg-white p-2">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs tracking-[0.06em] text-muted uppercase">
                {(["order", "customer", "items", "total", "payment", "status"] as const).map((c) => (
                  <th key={c} className="px-4 py-3.5 font-semibold">{t.columns[c]}</th>
                ))}
                <th className="px-4 py-3.5"><span className="sr-only">{t.columns.action}</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.data?.items.map((o) => (
                <Row key={o.id} order={o} selected={o.id === selectedId} onSelect={() => select(o.id)} />
              ))}
            </tbody>
          </table>
          {orders.data?.items.length === 0 && <div className="p-10 text-center text-muted">{t.empty}</div>}
          {orders.data && <Pager page={page} pageSize={orders.data.page_size} total={orders.data.total} onPage={setPage} />}
        </div>
        {selectedId && <DesktopPanel id={selectedId} />}
      </div>
    </>
  );
}

function Row({ order: o, selected, onSelect }: { order: OrderRow; selected: boolean; onSelect: () => void }) {
  return (
    <tr className={`border-t border-paper-staff ${selected ? "bg-paper" : ""}`}>
      <td className="px-4 py-3.5 font-bold">
        <button type="button" onClick={onSelect} className="cursor-pointer text-left font-bold underline">
          {o.number}
        </button>
        <span className="block text-xs font-normal text-muted">{placedLabel(o)}</span>
      </td>
      <td className="px-4 py-3.5">
        <span className="block font-semibold">{o.customer}</span>
        <span className="text-xs text-muted">{o.phone ?? "—"}</span>
      </td>
      <td className="px-4 py-3.5">{t.items(o.items)}</td>
      <td className="px-4 py-3.5 font-semibold whitespace-nowrap">{formatRwf(o.total_rwf)}</td>
      <td className="px-4 py-3.5 text-[13px]">{o.payment}</td>
      <td className="px-4 py-3.5">
        <StatusPill status={o.status} expired={o.expired} />
      </td>
      <td className="px-4 py-3.5 text-right">
        {t.next[o.status] && (
          <button type="button" onClick={onSelect} className="min-h-[38px] cursor-pointer rounded-full border border-ink bg-white px-3.5 text-xs font-semibold whitespace-nowrap">
            {t.next[o.status]}
          </button>
        )}
      </td>
    </tr>
  );
}

function DesktopPanel({ id }: { id: string }) {
  const order = useOrder(id);
  if (order.error) return <p role="alert" className="text-error">{errorText(order.error)}</p>;
  if (!order.data) return null;
  const o = order.data;
  return (
    <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-3xl bg-white p-6">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex flex-col gap-1">
          <span className="font-heading text-[26px] font-semibold">{o.number}</span>
          <span className="text-[13px] text-muted">{placedLabel(o)}</span>
        </div>
        <StatusPill status={o.status} expired={o.expired} />
      </div>
      {o.expired && <p className="m-0 rounded-2xl bg-blush px-3.5 py-2.5 text-[13px]">{t.expiredNote(o.hold_days)}</p>}
      <div className="flex flex-col gap-1 rounded-2xl bg-paper p-3.5 text-sm">
        <span className="font-semibold">{o.customer}</span>
        {o.phone && <a href={`tel:+250${o.phone.replace(/\D/g, "").slice(1)}`}>{o.phone}</a>}
        <span className="text-muted">
          {o.payment} · {formatRwf(o.total_rwf)}
        </span>
        {o.cancel_reason && <span className="text-error">{o.cancel_reason}</span>}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
        {o.line_items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3">
            <span>
              {i.qty} × {i.name}
              {i.variant_name && ` (${i.variant_name})`}
            </span>
            <span className="whitespace-nowrap">{formatRwf(i.line_total_rwf)}</span>
          </li>
        ))}
      </ul>
      <VerifyBox order={o} />
      <WhatsAppButton order={o} />
      {o.status === "preparing" && <PickList order={o} />}
      <History order={o} />
      <AdvanceButton order={o} />
      <CancelControl order={o} />
      {o.source === "walk_in" && (
        <Link to={`/staff/orders/${o.id}/receipt`} target="_blank" className="text-center text-sm font-semibold underline">
          {t.receipt}
        </Link>
      )}
    </div>
  );
}

/** "Pick these items" (M2), also shown on the desktop panel while preparing. */
function PickList({ order: o }: { order: OrderDetail }) {
  const pick = usePick();
  const done = o.line_items.filter((i) => i.picked).length;
  const editable = o.status === "new" || o.status === "preparing";
  return (
    <div className="rounded-[20px] bg-white px-3.5 py-1.5 md:border md:border-paper-staff">
      <div className="flex items-baseline justify-between pt-2.5 pb-1">
        <span className="text-[15px] font-bold">{t.pickTitle}</span>
        <span className="text-[13px] text-muted">{t.picked(done, o.line_items.length)}</span>
      </div>
      {o.line_items.map((i) => (
        <button
          key={i.id}
          type="button"
          aria-pressed={i.picked}
          disabled={!editable || pick.isPending}
          onClick={() => pick.mutate({ id: o.id, itemId: i.id, picked: !i.picked })}
          className="flex min-h-14 w-full cursor-pointer items-center gap-3 border-t border-paper-staff py-2 text-left disabled:cursor-default"
        >
          <span className={`flex size-[26px] shrink-0 items-center justify-center rounded-lg text-white ${i.picked ? "bg-[#3E6B52]" : "border-[1.5px] border-[#A9B3AC] bg-white"}`}>
            {i.picked && <icons.check size={14} />}
          </span>
          <span className="flex flex-1 flex-col gap-px">
            <span className={`text-sm font-semibold ${i.picked ? "text-muted line-through" : ""}`}>
              {i.name}
              {i.variant_name && ` (${i.variant_name})`}
            </span>
            <span className="text-xs text-muted">{i.location ?? "—"}</span>
          </span>
          <span className="text-[15px] font-bold">× {i.qty}</span>
        </button>
      ))}
      {pick.error && <p role="alert" className="m-0 pb-2 text-sm text-error">{errorText(pick.error)}</p>}
    </div>
  );
}

function MobileOrderList() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("");
  const [page, setPage] = usePage(filter);
  const orders = useOrders({ status: filter || "open", page });
  return (
    <div className="flex flex-col gap-3 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="m-0 font-heading text-[26px] font-semibold">{t.title}</h1>
        <Link to="/staff/sale" className="flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-semibold text-white no-underline">
          <icons.plus size={14} />
          {strings.dashboard.newSale}
        </Link>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {FILTERS.map((f) => (
          <button
            key={f || "all"}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-11 shrink-0 cursor-pointer rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap ${filter === f ? "border-ink bg-ink text-white" : "border-line bg-white"}`}
          >
            {f ? t.tabs[f] : t.tabs.all}
          </button>
        ))}
      </div>
      <OrderCards rows={orders.data?.items ?? []} />
      {orders.data && <Pager page={page} pageSize={orders.data.page_size} total={orders.data.total} onPage={setPage} />}
    </div>
  );
}

export function OrderCards({ rows }: { rows: { id: string; number: string; customer: string; items: number; status: OrderRow["status"]; payment: string }[] }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted">{strings.dashboard.queueEmpty}</p>;
  return (
    <>
      {rows.map((q) => (
        <Link key={q.id} to={`/staff/orders/${q.id}`} className="flex flex-col gap-2.5 rounded-[20px] bg-white p-3.5 no-underline">
          <span className="flex items-start justify-between gap-2.5">
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-bold">
                {q.number} · {q.customer}
              </span>
              <span className="text-[13px] text-muted">
                {t.items(q.items)} · {q.payment}
              </span>
            </span>
            <StatusPill status={q.status} />
          </span>
          {t.next[q.status] && (
            <span className="flex min-h-11 items-center justify-center rounded-[14px] border-[1.5px] border-ink text-sm font-semibold">{t.next[q.status]}</span>
          )}
        </Link>
      ))}
    </>
  );
}

const STEPS = ["new", "preparing", "ready", "collected"] as const;

function MobileOrder({ id }: { id: string }) {
  const navigate = useNavigate();
  const order = useOrder(id);
  if (order.error) return <p role="alert" className="pt-6 text-error">{errorText(order.error)}</p>;
  if (!order.data) return <p className="pt-6">{strings.staff.loading}</p>;
  const o = order.data;
  const step = STEPS.indexOf(o.status as (typeof STEPS)[number]);

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-center gap-2.5 pt-6 pb-1">
        <Link to="/staff/orders" aria-label={t.backToOrders} className="flex size-11 items-center justify-center rounded-full bg-white">
          <icons.back size={18} />
        </Link>
        <span className="flex flex-1 flex-col">
          <span className="font-heading text-2xl font-semibold">{o.number}</span>
          <span className="text-xs text-muted">{placedLabel(o)}</span>
        </span>
        <StatusPill status={o.status} expired={o.expired} />
      </header>
      {o.status !== "cancelled" && (
        <div className="grid grid-cols-4 gap-1.5 px-1 pt-1">
          {STEPS.map((s, i) => (
            <span key={s} className="flex flex-col gap-1.5">
              <span className={`block h-1.5 rounded-[3px] ${i <= step ? "bg-ink" : "bg-[#E4E0D6]"}`} />
              <span className={`text-[11px] ${i <= step ? "font-bold" : "font-medium text-muted"}`}>{t.status[s]}</span>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 rounded-[20px] bg-white p-3.5">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="font-bold">{o.customer}</span>
          <span className="text-[13px] text-muted">
            {o.phone ? `${o.phone} · ` : ""}
            {o.payment}
          </span>
        </span>
        {o.phone && (
          <a href={`tel:+250${o.phone.replace(/\D/g, "").slice(1)}`} aria-label={t.callTo(o.customer)} className="flex size-[46px] items-center justify-center rounded-full bg-sage">
            <icons.phone size={18} />
          </a>
        )}
      </div>
      <VerifyBox order={o} />
      <PickList order={o} />
      <div className="flex items-baseline justify-between rounded-[20px] bg-white p-3.5">
        <span className="font-semibold">{t.total}</span>
        <span className="font-heading text-[22px] font-semibold">{formatRwf(o.total_rwf)}</span>
      </div>
      <div className="flex flex-col gap-2 rounded-[20px] bg-white p-3.5">
        <History order={o} compact />
      </div>
      <CancelControl order={o} />
      <div className="sticky bottom-[96px] -mx-4 flex flex-col gap-1.5 border-t border-[#E4E0D6] bg-white px-4 pt-3 pb-3">
        <WhatsAppButton order={o} className="!min-h-[54px] !rounded-[18px] text-base" />
        <AdvanceButton order={o} className="!min-h-[54px] !rounded-[18px] text-base" onDone={() => o.status === "ready" && navigate("/staff")} />
        {o.source === "walk_in" && (
          <Link to={`/staff/orders/${o.id}/receipt`} target="_blank" className="text-center text-sm font-semibold underline">
            {t.receipt}
          </Link>
        )}
      </div>
    </div>
  );
}
