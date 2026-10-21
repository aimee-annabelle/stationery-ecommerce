// 5 · Order confirmed (design/OrderConfirmed.dc.html) and /track.
// The confirmation page shows the order only in the tab that placed it; anywhere else the customer looks
// it up with the order number and phone, because order numbers count up and could be guessed.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { icons } from "../../components/icons";
import { ApiError } from "../../lib/api";
import { formatDateTime, formatRwf } from "../../lib/format";
import { strings } from "../../strings";
import { placedOrders } from "./bag";
import { Price } from "./parts";
import { type PublicOrder, usePublicSettings, useSendPayment, useTrackOrder } from "./shopApi";

const t = strings.shop.order;
const STEP_INDEX: Record<string, number> = { new: 0, preparing: 1, ready: 2, collected: 3 };

const pickupLabel = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
        new Date(`${iso}T12:00:00Z`),
      )
    : "—";

export function OrderConfirmedPage() {
  const { number = "" } = useParams();
  const [order, setOrder] = useState<PublicOrder | null>(() => placedOrders.load<PublicOrder>(number));
  const update = (next: PublicOrder) => {
    placedOrders.save(next.number, { ...next, email: order?.email ?? next.email });
    setOrder((prev) => ({ ...next, email: prev?.email ?? next.email }));
  };

  if (!order) return <TrackPage initialNumber={number} />;

  const mobile = order.payment_method === "momo" || order.payment_method === "airtel";
  return (
    <>
      <section className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-12 px-4 pt-8 pb-16 sm:px-6">
        <div className="flex h-[280px] flex-[0_1_360px] items-center justify-center rounded-[999px_999px_40px_40px] bg-sage sm:h-[400px]">
          <span className="flex size-[132px] items-center justify-center rounded-full bg-ink text-white">
            <icons.check size={56} />
          </span>
        </div>
        <div className="flex flex-[1_1_480px] flex-col gap-5">
          <span className="self-start rounded-full bg-white px-4 py-2 text-sm font-semibold">{t.number(order.number)}</span>
          <h1 className="m-0 font-heading text-[44px] leading-[1.02] font-medium sm:text-[64px]">
            {t.thanks} <em className="text-terracotta">{t.thanksAccent}</em>
          </h1>
          <p className="m-0 max-w-[520px] text-lg leading-[1.65] text-[#3C4A42]">
            {order.email && t.receipt(order.email)}
            {mobile ? t.nextMomo(order.phone ?? "") : t.nextPickup(order.phone ?? "")}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/shop" className="flex min-h-[54px] items-center rounded-full bg-ink px-7 text-base font-semibold text-white no-underline">
              {t.continue}
            </Link>
            <Link to="/signup" className="flex min-h-[54px] items-center rounded-full border-[1.5px] border-ink px-7 text-base font-semibold no-underline">
              {t.createAccount}
            </Link>
          </div>
        </div>
      </section>
      <OrderDetails order={order} onUpdate={update} phoneForPayment={order.phone ?? ""} />
    </>
  );
}

export function TrackPage({ initialNumber = "" }: { initialNumber?: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [phone, setPhone] = useState("");

  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pt-8 pb-8 sm:px-6">
        <h1 className="m-0 font-heading text-[44px] font-medium sm:text-[56px]">{t.trackTitle}</h1>
        <p className="mt-2 text-base text-muted">{t.trackIntro}</p>
      </section>
      {order ? (
        <OrderDetails order={order} onUpdate={setOrder} phoneForPayment={phone} />
      ) : (
        <section className="mx-auto max-w-[1240px] px-4 pb-24 sm:px-6">
          <div className="max-w-[440px]">
            <LookupCard
              initialNumber={initialNumber}
              onFound={(found, usedPhone) => {
                setOrder(found);
                setPhone(usedPhone);
              }}
            />
          </div>
        </section>
      )}
    </>
  );
}

function OrderDetails({
  order,
  onUpdate,
  phoneForPayment,
}: {
  order: PublicOrder;
  onUpdate: (order: PublicOrder) => void;
  phoneForPayment: string;
}) {
  const current = STEP_INDEX[order.status] ?? -1;
  const cancelled = order.status === "cancelled";
  return (
    <section className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-6 px-4 pb-24 sm:px-6">
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-6">
        {order.pay && <PayBox order={order} phone={phoneForPayment} onUpdate={onUpdate} />}
        <div className="flex flex-col gap-6 rounded-[32px] bg-white p-6 sm:p-8">
          <h2 className="m-0 font-heading text-[30px] font-medium">{t.next}</h2>
          {cancelled ? (
            <p role="status" className="m-0 rounded-2xl bg-blush px-4 py-3">
              {t.statusLine.cancelled}
            </p>
          ) : (
            <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4 p-0">
              {t.steps.map(([title, note], i) => (
                <li key={title} className="flex flex-col gap-2.5" aria-current={i === current ? "step" : undefined}>
                  <span
                    className={`flex size-11 items-center justify-center rounded-full font-bold ${
                      i < current || (i === current && i === 0) ? "bg-ink text-white" : i === current ? "bg-butter" : "bg-paper"
                    }`}
                  >
                    {i < current || (i === current && i === 0) ? <icons.check size={18} /> : i + 1}
                  </span>
                  <span className="font-semibold">{title}</span>
                  <span className="text-sm text-muted">{i === 0 ? formatDateTime(order.placed_at) : note}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-[18px] border-t border-[#EEEBE4] pt-[22px]">
            <Fact label={t.pickupPoint} value={strings.shop.address} />
            <Fact label={t.pickupDay} value={pickupLabel(order.pickup_day)} />
            <Fact label={t.payment} value={order.payment_label} />
          </div>
        </div>
      </div>

      <div className="flex flex-[1_1_340px] flex-col gap-[18px]">
        <div className="flex flex-col gap-3.5 rounded-[32px] bg-white p-7">
          <h2 className="m-0 font-heading text-[26px] font-medium">{t.summary}</h2>
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between gap-3 text-[15px]">
              <span>
                {item.name}
                {item.variant_name && ` (${item.variant_name})`} × {item.qty}
              </span>
              <span className="whitespace-nowrap">{formatRwf(item.line_total_rwf)}</span>
            </div>
          ))}
          <div className="flex items-baseline justify-between border-t border-[#EEEBE4] pt-3.5">
            <span className="font-semibold">{t.total}</span>
            <Price amount={order.total_rwf} className="text-2xl" />
          </div>
        </div>
        {/* Checks another order: shows its status in the card, without replacing this one. */}
        <LookupCard onFound={() => undefined} />
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

/** MoMo or Airtel payment: the steps, with the order number as reference, and the transaction ID box. */
function PayBox({ order, phone, onUpdate }: { order: PublicOrder; phone: string; onUpdate: (o: PublicOrder) => void }) {
  const p = t.pay;
  const settings = usePublicSettings();
  const send = useSendPayment();
  const [method, setMethod] = useState<"momo" | "airtel">(order.payment_method === "airtel" ? "airtel" : "momo");
  const [txn, setTxn] = useState("");
  const pay = order.pay!;
  const methods = settings.data?.payment_methods;
  const code = methods?.[method]?.merchant_code ?? pay.merchant_code;
  const label = method === "airtel" ? strings.shop.checkout.airtel : strings.shop.checkout.mtn;

  const sent = order.payment_status === "awaiting_verification";
  const rejected = order.payment_status === "rejected";

  return (
    <form
      className="flex flex-col gap-4 rounded-[32px] bg-butter p-6 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (txn.trim()) send.mutate({ number: order.number, phone, method, transaction_id: txn }, { onSuccess: onUpdate });
      }}
    >
      <h2 className="m-0 font-heading text-[28px] font-medium">{p.title}</h2>
      <p className="m-0 text-base leading-relaxed">{p.steps(label, code, formatRwf(pay.amount_rwf), pay.reference)}</p>
      {rejected && (
        <p role="alert" className="m-0 rounded-2xl bg-white px-4 py-3 text-sm text-error">
          {p.rejected}
        </p>
      )}
      {sent && !send.isPending ? (
        <p role="status" className="m-0 flex items-center gap-2.5 rounded-2xl bg-white px-4 py-3 text-[15px]">
          <span className="size-2.5 rounded-full bg-[#C9A227]" />
          {p.sent}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-semibold">{p.network}</span>
            {(["momo", "airtel"] as const)
              .filter((m) => methods?.[m]?.enabled ?? true)
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold ${
                    method === m ? "border-ink bg-ink text-white" : "border-line bg-white"
                  }`}
                >
                  {m === "airtel" ? strings.shop.checkout.airtel : strings.shop.checkout.mtn}
                </button>
              ))}
          </div>
          <label className="flex flex-col gap-2 text-sm font-semibold">
            {p.txn}
            <input
              type="text"
              autoComplete="off"
              value={txn}
              onChange={(e) => setTxn(e.target.value)}
              placeholder={p.txnPlaceholder}
              className="min-h-[52px] w-full rounded-2xl border border-line bg-white px-4 text-base font-medium"
            />
            <span className="text-[13px] font-normal text-[#3C4A42]">{p.txnHelp}</span>
          </label>
          {send.error && (
            <p role="alert" className="m-0 text-sm text-error">
              {send.error instanceof ApiError ? send.error.message : strings.genericError}
            </p>
          )}
          <button
            type="submit"
            disabled={send.isPending || !txn.trim()}
            className="min-h-[52px] cursor-pointer self-start rounded-full bg-ink px-7 text-[15px] font-semibold text-white disabled:opacity-50"
          >
            {p.send}
          </button>
        </>
      )}
    </form>
  );
}

function LookupCard({ initialNumber = "", onFound }: { initialNumber?: string; onFound: (o: PublicOrder, phone: string) => void }) {
  const l = t.lookup;
  const track = useTrackOrder();
  const [number, setNumber] = useState(initialNumber);
  const [phone, setPhone] = useState("");

  return (
    <form
      className="flex flex-col gap-3.5 rounded-[32px] bg-blush p-7"
      onSubmit={(e) => {
        e.preventDefault();
        track.mutate({ number: number.trim(), phone }, { onSuccess: (o) => onFound(o, phone) });
      }}
    >
      <h2 className="m-0 font-heading text-2xl font-medium">{l.title}</h2>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {l.number}
        <input type="text" value={number} onChange={(e) => setNumber(e.target.value)} placeholder={l.numberPlaceholder} className="min-h-12 w-full rounded-[14px] bg-white px-3.5 text-[15px] font-medium" required />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        {l.phone}
        <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={l.phonePlaceholder} className="min-h-12 w-full rounded-[14px] bg-white px-3.5 text-[15px] font-medium" required />
      </label>
      <button type="submit" disabled={track.isPending} className="min-h-[50px] cursor-pointer rounded-full bg-ink text-[15px] font-semibold text-white disabled:opacity-50">
        {l.check}
      </button>
      {track.error && (
        <p role="alert" className="m-0 rounded-2xl bg-white p-3.5 text-sm text-error">
          {track.error instanceof ApiError ? track.error.message : strings.genericError}
        </p>
      )}
      {track.data && (
        <div role="status" className="flex items-center gap-2.5 rounded-2xl bg-white p-3.5 text-sm">
          <span className="size-2.5 rounded-full bg-[#C9A227]" />
          {t.status}: {t.statusLine[track.data.status] ?? track.data.status}
        </div>
      )}
    </form>
  );
}
