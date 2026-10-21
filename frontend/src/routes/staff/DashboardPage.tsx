// S1 · Dashboard by role (design/AdminDashboard.dc.html) and, on a phone, M1 · Worker home
// (design/MobileHome.dc.html). The API only sends the sections the role may see.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { icons } from "../../components/icons";
import { formatRwf } from "../../lib/format";
import { staffApi, useStaffSession } from "../../lib/staffSession";
import { useIsPhone } from "../../lib/useMediaQuery";
import { strings } from "../../strings";
import { type Dashboard, useDashboard } from "./orders/ordersApi";
import { OrderCards } from "./orders/OrdersPage";

const t = strings.dashboard;

const KPI_STYLE: Record<string, [string, string]> = {
  sales_today_rwf: ["bg-[#3E6B52]", "/staff/reports"],
  orders_today: ["bg-[#8A79B8]", "/staff/orders"],
  open_print_requests: ["bg-terracotta", "/staff/requests"],
  low_stock_items: ["bg-[#C9A227]", "/staff/products"],
  products_listed: ["bg-[#3E6B52]", "/staff/products"],
  deliveries_this_week: ["bg-[#8A79B8]", "/staff/products"],
  open_orders: ["bg-terracotta", "/staff/orders"],
  to_prepare: ["bg-[#C9A227]", "/staff/orders"],
  ready: ["bg-[#3E6B52]", "/staff/orders"],
  requests_to_quote: ["bg-terracotta", "/staff/requests"],
};

const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const clock = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const weekday = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

/** Plain words for an activity log entry ("marked order PH-0012 as Ready"). The full log comes in stage 6. */
function describe(a: NonNullable<Dashboard["activity"]>[number]): string {
  const after = a.after ?? {};
  const label = a.label ?? "";
  switch (a.action) {
    case "order.status_changed":
      return `marked order ${label} as ${strings.orders.status[String(after.status)] ?? after.status}`;
    case "order.created":
      return `recorded walk-in sale ${label}`;
    case "order.cancelled":
      return `cancelled order ${label}`;
    case "order.refunded":
      return `refunded order ${label}`;
    case "order.payment_verified":
      return `confirmed the payment for ${label}`;
    case "order.payment_rejected":
      return `couldn't find the payment for ${label}`;
    case "order.whatsapp_opened":
      return `opened WhatsApp for ${label}`;
    case "stock.received":
      return `received ${after.received} × ${label}`;
    case "stock.adjusted":
      return `adjusted stock of ${label} by ${after.change}`;
    case "product.price_changed":
      return `changed the price of ${label} to ${formatRwf(Number(after.price_rwf))}`;
    case "product.created":
      return `added product ${label}`;
    case "staff.signed_in_new_device":
      return "signed in on a new device";
    default:
      return `${a.action.replace(/[._]/g, " ")} ${label}`.trim();
  }
}

export function DashboardPage() {
  const isPhone = useIsPhone();
  const board = useDashboard();
  if (!board.data) return <p>{strings.staff.loading}</p>;
  return isPhone ? <PhoneHome board={board.data} /> : <DesktopDashboard board={board.data} />;
}

function DesktopDashboard({ board }: { board: Dashboard }) {
  const { staff } = useStaffSession();
  const card = "flex flex-col gap-4 rounded-3xl bg-white p-6";
  const h2 = "m-0 font-body text-lg font-bold";
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.greeting(staff?.name ?? "")}</h1>
          <p>{t.subtitle[board.role]}</p>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        {Object.entries(board.kpis).map(([key, value]) => (
          <div key={key} className="flex flex-col gap-2.5 rounded-3xl bg-white p-[22px]">
            <span className="flex items-center gap-2.5 text-sm text-muted">
              <span className={`size-2.5 rounded-full ${KPI_STYLE[key]?.[0] ?? "bg-ink"}`} />
              {t.kpi[key] ?? key}
            </span>
            <span className="text-[32px] font-bold tracking-[-0.02em]">{key.endsWith("_rwf") ? formatRwf(value) : value}</span>
            <Link to={KPI_STYLE[key]?.[1] ?? "/staff"} className="text-[13px] font-semibold underline">
              {t.kpiLink[key]}
            </Link>
          </div>
        ))}
      </div>

      <MessagesCard />

      {board.role === "worker" && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3.5">
          <QuickLink to="/staff/sale" dark icon={<icons.bag size={20} />} tint="bg-sage" label={t.newWalkIn} />
          <QuickLink to="/staff/requests" icon={<icons.print size={20} />} tint="bg-butter" label={t.newRequest} />
          <QuickLink to="/staff/products" icon={<icons.search size={20} />} tint="bg-lilac" label={t.lookUp} />
        </div>
      )}

      {board.sales_7d && (
        <div className="flex flex-wrap gap-4">
          <div className={`${card} flex-[2_1_480px]`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={h2}>{t.sales}</h2>
              <Link to="/staff/reports" className="text-[13px] font-semibold underline">{t.fullReport}</Link>
            </div>
            <SalesChart days={board.sales_7d} />
          </div>
          <LowStockCard title={t.lowStock} items={board.low_stock ?? []} link={t.manageStock} />
        </div>
      )}

      {board.activity && (
        <div className="flex flex-wrap gap-4">
          <div className={`${card} flex-[2_1_480px] !gap-1.5`}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className={h2}>{t.whoDidWhat}</h2>
              <Link to="/staff/activity" className="text-[13px] font-semibold underline">{t.fullLog}</Link>
            </div>
            {board.activity.length === 0 && <p className="m-0 text-sm text-muted">{t.nothingToday}</p>}
            {board.activity.map((a, i) => (
              <div key={i} className="flex items-center gap-3 border-t border-paper-staff py-2.5 first-of-type:border-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sage text-xs font-bold">{initials(a.who)}</span>
                <span className="flex-1 text-sm leading-normal">
                  <strong className="font-semibold">{a.who}</strong> {describe(a)}
                </span>
                <span className="text-[13px] whitespace-nowrap text-muted">{clock(a.at)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-[1_1_300px] flex-col gap-3.5 rounded-3xl bg-ink p-6 text-white">
            <h2 className={h2}>{t.onShift}</h2>
            {(board.on_shift ?? []).length === 0 && <p className="m-0 text-sm text-[#CFDCD3]">{t.nobody}</p>}
            {board.on_shift?.map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-sage text-xs font-bold text-ink">{initials(s.name)}</span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{s.name}</span>
                  <span className="text-xs text-[#CFDCD3]">{t.actions(strings.staff.roles[s.role as "manager"], s.actions)}</span>
                </span>
              </div>
            ))}
            <Link to="/staff/team" className="mt-auto text-[13px] font-semibold text-sage underline">{t.manageStaff}</Link>
          </div>
        </div>
      )}

      {board.restock && (
        <div className="flex flex-wrap gap-4">
          <LowStockCard title={t.restock} items={board.restock} link={strings.products.receive} wide />
          <div className={`${card} flex-[1_1_300px] !gap-2`}>
            <h2 className={h2}>{t.recentMoves}</h2>
            {board.moves?.map((m, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-t border-paper-staff py-2 first-of-type:border-0">
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{m.name}</span>
                  <span className="text-xs text-muted">
                    {strings.products.moves.reasons[m.reason] ?? m.reason} · {m.by}
                  </span>
                </span>
                <span className={m.change > 0 ? "change-up" : "change-down"}>{m.change > 0 ? `+${m.change}` : `−${-m.change}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${card} !gap-2`}>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className={h2}>{strings.orders.queue}</h2>
          <Link to="/staff/orders" className="text-[13px] font-semibold underline">{strings.orders.allOrders}</Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5 [&>a]:border [&>a]:border-paper-staff">
          <OrderCards rows={board.queue} />
        </div>
      </div>
    </>
  );
}

/** Contact page messages waiting for a reply (not designed; built in the dashboard card style). */
function MessagesCard() {
  const client = useQueryClient();
  const messages = useQuery({
    queryKey: ["staff", "messages"],
    queryFn: () => staffApi<{ id: string; name: string; phone: string; message: string; created_at: string }[]>("/staff/contact-messages"),
    refetchInterval: 60_000,
  });
  const handled = useMutation({
    mutationFn: (id: string) => staffApi(`/staff/contact-messages/${id}/handled`, { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["staff", "messages"] }),
  });
  const list = messages.data ?? [];
  if (list.length === 0) return null;
  const m = strings.messages;
  return (
    <div className="flex flex-col gap-2 rounded-3xl bg-white p-6">
      <h2 className="m-0 font-body text-lg font-bold">
        {m.title} <span className="ml-1 rounded-full bg-blush px-2 py-0.5 text-xs">{list.length}</span>
      </h2>
      {list.map((msg) => (
        <div key={msg.id} className="flex flex-wrap items-start gap-3 border-t border-paper-staff py-3 first-of-type:border-0">
          <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
            <span className="text-sm font-semibold">
              {msg.name} · <a href={`tel:+250${msg.phone.replace(/\D/g, "").slice(1)}`} aria-label={m.call(msg.name)}>{msg.phone}</a>
              <span className="ml-2 text-xs font-normal text-muted">{clock(msg.created_at)}</span>
            </span>
            <span className="text-sm whitespace-pre-line text-[#3C4A42]">{msg.message}</span>
          </span>
          <button type="button" disabled={handled.isPending} onClick={() => handled.mutate(msg.id)} className="min-h-11 cursor-pointer rounded-full border border-line bg-white px-4 text-[13px] font-semibold">
            {m.handled}
          </button>
        </div>
      ))}
    </div>
  );
}

function QuickLink({ to, icon, tint, label, dark = false }: { to: string; icon: React.ReactNode; tint: string; label: string; dark?: boolean }) {
  return (
    <Link to={to} className={`flex min-h-20 items-center gap-3.5 rounded-3xl p-[22px] no-underline ${dark ? "bg-ink text-white" : "bg-white"}`}>
      <span className={`flex size-11 items-center justify-center rounded-full text-ink ${tint}`}>{icon}</span>
      <span className="font-semibold">{label}</span>
    </Link>
  );
}

function SalesChart({ days }: { days: { day: string; total_rwf: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.total_rwf));
  return (
    <div>
      <div className="flex h-[200px] items-end gap-3 border-b border-[#EEEBE4]">
        {days.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <span className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 -translate-y-full rounded-lg bg-ink px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block group-focus-within:block">
              {formatRwf(d.total_rwf)}
            </span>
            <button
              type="button"
              aria-label={`${weekday(d.day)}: ${formatRwf(d.total_rwf)}`}
              className={`w-full cursor-default rounded-t-xl ${i === days.length - 1 ? "bg-ink" : "bg-sage"}`}
              style={{ height: `${Math.max(2, (d.total_rwf / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3">
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center text-xs text-muted">{weekday(d.day)}</span>
        ))}
      </div>
    </div>
  );
}

function LowStockCard({ title, items, link, wide = false }: { title: string; items: NonNullable<Dashboard["low_stock"]>; link: string; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-3.5 rounded-3xl bg-white p-6 ${wide ? "flex-[2_1_480px]" : "flex-[1_1_300px]"}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 font-body text-lg font-bold">{title}</h2>
        <Link to="/staff/products" className="text-[13px] font-semibold underline">{link}</Link>
      </div>
      {items.map((l) => (
        <Link key={l.product_id} to={`/staff/products/${l.product_id}`} className="flex flex-col gap-1.5 no-underline">
          <div className="flex justify-between text-sm">
            <span className="font-medium">
              {l.name}
              {l.flagged && <span className="ml-2 rounded-full bg-blush px-2 py-0.5 text-[11px] font-semibold">{t.flagged}</span>}
            </span>
            <span className="font-bold">{wide ? t.leftAlert(l.left, l.alert) : t.left(l.left)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-[#EEEBE4]">
            <div className="h-full rounded-[3px] bg-terracotta" style={{ width: `${Math.max(6, Math.min(100, (l.left / Math.max(1, l.alert)) * 100))}%` }} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function PhoneHome({ board }: { board: Dashboard }) {
  const { staff } = useStaffSession();
  const counts = board.queue.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.status]: (acc[q.status] ?? 0) + 1 }), {});
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "Africa/Kigali" }).format(new Date());
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3 pt-7 pb-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] text-muted">
            {today} · {t.tumba}
          </span>
          <span className="font-heading text-[28px] font-semibold">{t.greeting(staff?.name ?? "").replace("Hello", "Hi")}</span>
        </div>
        <span aria-label={`${staff?.name}, ${staff ? strings.staff.roles[staff.role] : ""}`} className="flex size-11 items-center justify-center rounded-full bg-sage text-sm font-bold">
          {initials(staff?.name ?? "")}
        </span>
      </header>
      <div className="grid grid-cols-3 gap-2">
        {[
          [t.toPrepare, (counts.new ?? 0) + (counts.preparing ?? 0), "bg-butter"],
          [t.readyShort, counts.ready ?? 0, "bg-sage"],
          [t.toQuote, board.kpis.requests_to_quote ?? board.kpis.open_print_requests ?? 0, "bg-blush"],
        ].map(([label, n, bg]) => (
          <div key={label as string} className={`flex flex-col gap-0.5 rounded-[18px] p-3 ${bg}`}>
            <span className="text-2xl font-bold">{n}</span>
            <span className="text-xs font-medium">{label}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Link to="/staff/sale" className="flex min-h-[88px] flex-col justify-between rounded-[20px] bg-ink p-3.5 text-white no-underline">
          <icons.bag size={22} />
          <span className="text-[15px] font-semibold">{t.newSale}</span>
        </Link>
        <Link to="/staff/products" className="flex min-h-[88px] flex-col justify-between rounded-[20px] bg-white p-3.5 no-underline">
          <icons.search size={22} />
          <span className="text-[15px] font-semibold">{t.findProduct}</span>
        </Link>
      </div>
      <MessagesCard />
      <div className="flex items-baseline justify-between">
        <h1 className="m-0 font-body text-[17px] font-bold">{strings.orders.queue}</h1>
        <span className="text-[13px] text-muted">{strings.orders.queueHint}</span>
      </div>
      <OrderCards rows={board.queue} />
    </div>
  );
}
