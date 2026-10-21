// C1 · My account (design/Account.dc.html): Overview, My orders, Print requests, Profile.

import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { icons } from "../../components/icons";
import { Pager } from "../../components/Pager";
import { ApiError } from "../../lib/api";
import { formatDateTime, formatPhone, formatRwf } from "../../lib/format";
import { useCustomerSession } from "../../lib/customerSession";
import { strings } from "../../strings";
import { bag } from "../shop/bag";
import { ProductArt } from "../shop/parts";
import { inputClass, PasswordInput } from "./AuthShell";
import {
  type MyRequest,
  useAcceptQuote,
  useCancelMyOrder,
  useChangePassword,
  useMyOrders,
  useMyRequests,
  useOverview,
  useReorder,
  useUpdateProfile,
} from "./accountApi";

const t = strings.account;
type Tab = "overview" | "orders" | "requests" | "profile";
const PILL: Record<string, string> = {
  new: "bg-lilac", preparing: "bg-butter", ready: "bg-sage", collected: "bg-[#EEEBE4]", cancelled: "bg-blush",
  quoted: "bg-blush", in_progress: "bg-butter",
};
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? strings.genericError : null);
const card = "flex flex-col gap-4 rounded-[32px] bg-white p-6 sm:p-8";
const h2 = "m-0 font-heading text-[26px] font-medium sm:text-[28px]";

export function AccountPage() {
  const { status, customer, logout } = useCustomerSession();
  const [params, setParams] = useSearchParams();
  const tab = (["overview", "orders", "requests", "profile"].includes(params.get("tab") ?? "") ? params.get("tab") : "overview") as Tab;
  const navigate = useNavigate();

  if (status === "loading") return <p className="mx-auto max-w-[1240px] px-6 py-10">{strings.shop.loading}</p>;
  if (!customer) return <Navigate to="/login?next=/account" replace />;

  return (
    <section className="mx-auto max-w-[1240px] px-4 pt-4 pb-24 sm:px-6">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 font-heading text-[44px] leading-none font-medium sm:text-[60px]">
          {t.hello} <em className="text-terracotta">{customer.name.split(" ")[0]}.</em>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label={t.tabsLabel} className="flex flex-wrap gap-1.5 rounded-full bg-white p-[5px]">
            {(Object.keys(t.tabs) as Tab[]).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setParams(id === "overview" ? {} : { tab: id }, { replace: true })}
                className={`min-h-[42px] cursor-pointer rounded-full px-[18px] text-sm font-semibold ${tab === id ? "bg-ink text-white" : ""}`}
              >
                {t.tabs[id]}
              </button>
            ))}
          </div>
          <button type="button" onClick={async () => { await logout(); navigate("/"); }} className="min-h-[42px] cursor-pointer rounded-full px-4 text-sm font-semibold underline">
            {t.logOut}
          </button>
        </div>
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "orders" && <OrdersTab />}
      {tab === "requests" && <RequestsTab />}
      {tab === "profile" && <ProfileTab />}
    </section>
  );
}

function OverviewTab() {
  const overview = useOverview();
  const accept = useAcceptQuote();
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const o = overview.data;
  if (!o) return <p>{strings.shop.loading}</p>;
  const current = o.current_order;
  const step = current ? ["new", "preparing", "ready", "collected"].indexOf(current.status) : -1;
  const quote = o.open_quote;

  return (
    <>
      <div className="flex flex-wrap items-stretch gap-5">
        <div className={`${card} flex-[2_1_520px] !gap-[22px]`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={h2}>{t.currentOrder}</h2>
            {current && <span className="text-sm text-muted">{t.orderLine(current.number, current.items.reduce((s, i) => s + i.qty, 0), formatRwf(current.total_rwf))}</span>}
          </div>
          {current ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                {t.steps.map((label, i) => (
                  <span key={label} className="flex flex-col gap-2">
                    <span className={`h-2 rounded ${i <= step ? "bg-ink" : "bg-[#E9E5DB]"}`} />
                    <span className={`text-[13px] ${i <= step ? "font-semibold" : "text-muted"}`}>{label}</span>
                  </span>
                ))}
              </div>
              <div className="rounded-[20px] bg-sage px-[18px] py-4 text-sm leading-relaxed">
                {t.statusNote[current.status]}
                {t.payNote(current.payment_label)}
              </div>
              {current.pay && (
                <Link to="/track" className="text-sm font-semibold underline">{strings.shop.order.pay.title}</Link>
              )}
            </>
          ) : (
            <p className="m-0 text-muted">{t.noCurrent}</p>
          )}
        </div>
        {quote && (
          <div className="flex flex-[1_1_320px] flex-col gap-3.5 rounded-[32px] bg-blush p-7">
            <span className="text-[13px] font-semibold">{t.requestLine(quote.number, strings.requests.type[quote.type])}</span>
            <h2 className="m-0 font-heading text-[26px] font-medium">{t.quoteTitle[quote.status] ?? t.reqStatus[quote.status]}</h2>
            <span className="text-[15px] leading-relaxed">
              {quote.summary}
              {quote.ready_on && ` · ready on ${day(quote.ready_on)}`}
              {quote.quote_rwf != null && <> · <strong>{formatRwf(quote.quote_rwf)}</strong></>}
            </span>
            {quote.status === "quoted" ? (
              <div className="mt-auto flex flex-wrap gap-2.5">
                <button type="button" disabled={accept.isPending} onClick={() => accept.mutate(quote.id)} className="min-h-[50px] flex-1 cursor-pointer rounded-full bg-ink text-[15px] font-semibold text-white disabled:opacity-50">
                  {t.acceptQuote}
                </button>
                <Link to="/contact" className="flex min-h-[50px] flex-1 items-center justify-center rounded-full border-[1.5px] border-ink text-[15px] font-semibold no-underline">
                  {t.askQuestion}
                </Link>
              </div>
            ) : quote.status === "in_progress" ? (
              <span role="status" className="mt-auto rounded-2xl bg-white px-3.5 py-3 text-sm">{t.accepted}</span>
            ) : null}
            {accept.error && <span role="alert" className="text-sm text-error">{errorText(accept.error)}</span>}
          </div>
        )}
      </div>

      {o.buy_again.length > 0 && (
        <div className={`${card} mt-5`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={h2}>{t.buyAgain}</h2>
            <Link to="/shop" className="text-sm font-semibold underline">{t.goShop}</Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3.5">
            {o.buy_again.map((g) => {
              const key = `${g.product_id}:${g.variant_id}`;
              const on = !!added[key];
              return (
                <div key={key} className="flex items-center gap-3.5 rounded-[22px] bg-paper p-3">
                  <ProductArt image={g.image} tint={g.tint} categorySlug={g.category_slug} className="size-16 shrink-0 rounded-2xl" iconSize={26} />
                  <span className="flex flex-1 flex-col gap-0.5">
                    {g.slug ? <Link to={`/shop/${g.slug}`} className="text-[15px] font-semibold no-underline">{g.name}</Link> : <span className="text-[15px] font-semibold">{g.name}</span>}
                    <span className="text-[13px] text-muted">{t.lastBought(day(g.last_bought))}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={on ? t.added(g.name) : t.add(g.name)}
                    disabled={!g.available || on}
                    onClick={() => {
                      bag.add(g.product_id, g.variant_id, 1);
                      setAdded({ ...added, [key]: true });
                    }}
                    className={`flex size-[46px] shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-default ${on ? "bg-ink text-white" : "bg-white"} ${!g.available ? "opacity-30" : ""}`}
                  >
                    {on ? <icons.check size={18} /> : <icons.plus size={18} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function OrdersTab() {
  const [page, setPage] = useState(1);
  const orders = useMyOrders(page);
  const reorder = useReorder();
  const cancel = useCancelMyOrder();
  const navigate = useNavigate();
  if (!orders.data) return <p>{strings.shop.loading}</p>;
  if (orders.data.total === 0) return <p className={card}>{t.noOrders}</p>;
  return (
    <div className="flex flex-col gap-3">
      {orders.data.items.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center gap-x-7 gap-y-3.5 rounded-[28px] bg-white px-6 py-[22px]">
          <span className="flex flex-[0_0_110px] flex-col gap-0.5">
            <span className="font-bold">{o.number}</span>
            <span className="text-[13px] text-muted">{formatDateTime(o.placed_at)}</span>
          </span>
          <span className="flex-[1_1_220px] text-sm text-[#3C4A42]">{o.items}</span>
          <span className="min-w-[120px] font-heading text-xl font-semibold">{formatRwf(o.total_rwf)}</span>
          <span className={`rounded-full px-3.5 py-[7px] text-[13px] font-semibold ${PILL[o.status] ?? "bg-[#EEEBE4]"}`}>{strings.orders.status[o.status]}</span>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={reorder.isPending} onClick={() => reorder.mutate(o.id, { onSuccess: () => navigate("/cart") })} className="min-h-11 cursor-pointer rounded-full bg-ink px-[18px] text-sm font-semibold text-white">
              {t.reorder}
            </button>
            {o.can_cancel && (
              <button
                type="button"
                disabled={cancel.isPending}
                onClick={() => window.confirm(t.confirmCancel(o.number)) && cancel.mutate(o.id)}
                className="min-h-11 cursor-pointer rounded-full border border-error bg-white px-[18px] text-sm font-semibold text-error"
              >
                {t.cancel}
              </button>
            )}
          </div>
          {!o.can_cancel && ["new", "preparing", "ready"].includes(o.status) && (
            <span className="basis-full text-[13px] text-muted">{t.callToCancel}</span>
          )}
        </div>
      ))}
      {(cancel.error || reorder.error) && <p role="alert" className="text-sm text-error">{errorText(cancel.error || reorder.error)}</p>}
      <Pager page={page} pageSize={orders.data.page_size} total={orders.data.total} onPage={setPage} />
    </div>
  );
}

function RequestsTab() {
  const [page, setPage] = useState(1);
  const requests = useMyRequests(page);
  const accept = useAcceptQuote();
  if (!requests.data) return <p>{strings.shop.loading}</p>;
  return (
    <div className="flex flex-col gap-3">
      {requests.data.total === 0 && <p className={card}>{t.noRequests}</p>}
      {requests.data.items.map((r: MyRequest) => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-7 gap-y-3 rounded-[28px] bg-white px-6 py-[22px]">
          <span className="flex flex-[1_1_260px] flex-col gap-0.5">
            <span className="font-bold">
              {r.number} · {strings.requests.type[r.type]}
            </span>
            <span className="text-sm text-[#3C4A42]">{r.summary}{r.ready_on && ` · ready on ${day(r.ready_on)}`}</span>
          </span>
          {r.quote_rwf != null && <span className="font-heading text-xl font-semibold">{t.quote(formatRwf(r.quote_rwf))}</span>}
          <span className={`rounded-full px-3.5 py-[7px] text-[13px] font-semibold ${PILL[r.status] ?? "bg-[#EEEBE4]"}`}>{t.reqStatus[r.status]}</span>
          {r.status === "quoted" && (
            <button type="button" disabled={accept.isPending} onClick={() => accept.mutate(r.id)} className="min-h-11 cursor-pointer rounded-full bg-ink px-[18px] text-sm font-semibold text-white">
              {t.acceptQuote}
            </button>
          )}
        </div>
      ))}
      <Pager page={page} pageSize={requests.data.page_size} total={requests.data.total} onPage={setPage} />
      <Link to="/services" className="flex min-h-[50px] items-center gap-2 self-start rounded-full bg-ink px-6 text-[15px] font-semibold text-white no-underline">
        <icons.plus size={16} />
        {t.newRequest}
      </Link>
    </div>
  );
}

function ProfileTab() {
  const { customer, setCustomer } = useCustomerSession();
  const update = useUpdateProfile();
  const password = useChangePassword();
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer ? formatPhone(customer.phone) : "");
  const [saved, setSaved] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  useEffect(() => setSaved(false), [name, phone]);
  if (!customer) return null;

  const toggle = (key: "whatsapp_updates" | "marketing_opt_in") =>
    update.mutate({ [key]: !customer[key] }, { onSuccess: setCustomer });

  return (
    <div className="flex flex-wrap items-start gap-5">
      <form
        className={`${card} flex-[2_1_480px]`}
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ name, phone }, { onSuccess: (c) => { setCustomer(c); setSaved(true); } });
        }}
      >
        <h2 className={h2}>{t.yourDetails}</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
          <label className="flex flex-col gap-2 text-sm font-semibold">{t.name}<input value={name} onChange={(e) => setName(e.target.value)} className={inputClass()} /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold">{t.phone}<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass()} /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold">
            {t.email}
            <input value={customer.email} readOnly className={`${inputClass()} bg-paper text-muted`} />
            <span className="text-xs font-normal text-muted">{t.emailFixed}</span>
          </label>
        </div>
        {update.error && <p role="alert" className="m-0 text-sm text-error">{errorText(update.error)}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={update.isPending} className="min-h-[50px] cursor-pointer rounded-full bg-ink px-6 text-[15px] font-semibold text-white">{t.save}</button>
          {saved && <span role="status" className="text-sm text-[#2F6B45]">{t.saved}</span>}
        </div>
      </form>
      <div className="flex flex-[1_1_320px] flex-col gap-5">
        <div className={card}>
          <h2 className={h2}>{t.notifications}</h2>
          {(["whatsapp_updates", "marketing_opt_in"] as const).map((key) => (
            <label key={key} className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
              {key === "whatsapp_updates" ? t.whatsappReady : t.offers}
              <button
                type="button"
                role="switch"
                aria-checked={customer[key]}
                onClick={() => toggle(key)}
                className={`flex h-7 w-12 shrink-0 cursor-pointer rounded-full p-[3px] ${customer[key] ? "justify-end bg-[#3E6B52]" : "justify-start bg-[#C9C4B8]"}`}
              >
                <span className="block size-[22px] rounded-full bg-white" />
              </button>
            </label>
          ))}
        </div>
        <form
          className={card}
          onSubmit={(e) => {
            e.preventDefault();
            password.mutate({ current_password: current, new_password: next }, { onSuccess: () => { setCurrent(""); setNext(""); } });
          }}
        >
          <h2 className={h2}>{t.passwordTitle}</h2>
          <label className="flex flex-col gap-2 text-sm font-semibold">{t.currentPassword}<PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" /></label>
          <label className="flex flex-col gap-2 text-sm font-semibold">{t.newPassword}<PasswordInput value={next} onChange={setNext} autoComplete="new-password" placeholder={strings.auth.newPasswordPlaceholder} /></label>
          {password.error && <p role="alert" className="m-0 text-sm text-error">{errorText(password.error)}</p>}
          {password.isSuccess && <p role="status" className="m-0 text-sm text-[#2F6B45]">{t.passwordUpdated}</p>}
          <button type="submit" disabled={password.isPending || !current || next.length < 8} className="min-h-[50px] cursor-pointer rounded-full bg-ink text-[15px] font-semibold text-white disabled:opacity-50">{t.updatePassword}</button>
        </form>
      </div>
    </div>
  );
}
