// 4 · Checkout (design/Checkout.dc.html). The order is placed first; the customer pays on the next page,
// with the order number as the MoMo reference.

import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { icons } from "../../components/icons";
import { ApiError } from "../../lib/api";
import { useCustomerSession } from "../../lib/customerSession";
import { formatPhone, formatRwf } from "../../lib/format";
import { strings } from "../../strings";
import { bag, placedOrders, useBag } from "./bag";
import { Price, ProductArt } from "./parts";
import { type PaymentMethod, useBagQuote, useOpeningHours, usePlaceOrder, usePublicSettings } from "./shopApi";
import { Select } from "../../components/Select";

const t = strings.shop.checkout;

const kigaliToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali" }).format(new Date());
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

export function CheckoutPage() {
  const navigate = useNavigate();
  const lines = useBag();
  const quote = useBagQuote(lines);
  const settings = usePublicSettings();
  const place = usePlaceOrder();
  const { customer } = useCustomerSession();
  const hours = useOpeningHours("[OPENING HOURS]");

  // Signed-in customers start with their own details (they can still change them for this order).
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer ? formatPhone(customer.phone) : "");
  const [email, setEmail] = useState(customer?.email ?? "");
  useEffect(() => {
    // The session can finish loading after the first render; fill only empty fields.
    if (!customer) return;
    setName((v) => v || customer.name);
    setPhone((v) => v || formatPhone(customer.phone));
    setEmail((v) => v || customer.email);
  }, [customer]);
  const [dayChoice, setDayChoice] = useState<"today" | "tomorrow" | "later" | null>(null);
  const [laterDay, setLaterDay] = useState("");
  const [pay, setPay] = useState<"mobile" | "pickup" | null>(null);
  const [network, setNetwork] = useState<"momo" | "airtel" | null>(null);
  const [tried, setTried] = useState(false);

  const methods = settings.data?.payment_methods;
  const mobileEnabled = !!(methods?.momo.enabled || methods?.airtel.enabled);
  const payChoice = pay ?? (mobileEnabled ? "mobile" : "pickup");
  const networkChoice = network ?? (methods?.momo.enabled ? "momo" : "airtel");

  const days = useMemo(() => {
    const open = settings.data?.pickup_days ?? [];
    const today = kigaliToday();
    const tomorrow = addDays(today, 1);
    return {
      today: open.includes(today) ? today : null,
      tomorrow: open.includes(tomorrow) ? tomorrow : null,
      later: open.filter((d) => d !== today && d !== tomorrow),
    };
  }, [settings.data]);
  const defaultChoice = days.today ? "today" : days.tomorrow ? "tomorrow" : "later";
  const choice = dayChoice ?? defaultChoice;
  const pickupDay = choice === "today" ? days.today : choice === "tomorrow" ? days.tomorrow : laterDay || days.later[0];

  const nameOk = name.trim().length > 1;
  const phoneOk = phone.replace(/\D/g, "").length >= 9;
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const valid = nameOk && phoneOk && emailOk && !!pickupDay;

  if (lines.length === 0 && !place.isSuccess) return <Navigate to="/cart" replace />;

  const method: PaymentMethod = payChoice === "pickup" ? "pay_at_pickup" : networkChoice;
  const code = methods?.[networkChoice]?.merchant_code ?? "[MERCHANT CODE]";
  const total = quote.data?.total_rwf ?? 0;

  const onPlace = () => {
    setTried(true);
    if (!valid || !pickupDay) return;
    place.mutate(
      { lines, name: name.trim(), phone, email: email.trim() || null, pickup_day: pickupDay, payment_method: method },
      {
        onSuccess: (order) => {
          placedOrders.save(order.number, order);
          // Leave checkout before emptying the bag, so the empty-bag redirect doesn't run first.
          navigate(`/orders/${order.number}/confirmed`);
          bag.clear();
        },
      },
    );
  };

  const placeError =
    place.error instanceof ApiError
      ? place.error.code === "bag_changed"
        ? t.bagChanged
        : place.error.message
      : place.error
        ? strings.genericError
        : null;

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-[#E4E0D6]">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <Link to="/" className="font-heading text-[28px] font-bold no-underline">
            Pahyems<span className="text-terracotta">.</span>
          </Link>
          <span className="hidden items-center gap-2 text-sm font-medium text-[#3C4A42] sm:flex">
            <icons.lock size={16} />
            {t.secure}
          </span>
          <Link to="/cart" className="py-3 text-[15px] font-semibold underline">
            {t.back}
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-[1240px] px-4 pt-10 pb-24 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <h1 className="m-0 font-heading text-[44px] leading-none font-medium sm:text-[56px]">{t.title}</h1>
          {!customer && (
            <span className="text-[15px] text-muted">
              {t.haveAccount}{" "}
              <Link to="/login?next=/checkout" className="font-semibold underline">
                {strings.shop.logIn}
              </Link>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-8">
          <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px]">
            <Step n={1} title={t.details}>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
                <Field label={t.name} error={tried && !nameOk ? t.nameError : null}>
                  <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} aria-invalid={tried && !nameOk} className={inputClass(tried && !nameOk)} />
                </Field>
                <Field label={t.phone} error={tried && !phoneOk ? t.phoneError : null}>
                  <input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phonePlaceholder} aria-invalid={tried && !phoneOk} className={inputClass(tried && !phoneOk)} />
                </Field>
                <Field
                  label={
                    <>
                      {t.email} <span className="font-normal text-muted">{t.emailOptional}</span>
                    </>
                  }
                  error={tried && !emailOk ? t.emailError : null}
                >
                  <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.emailPlaceholder} aria-invalid={tried && !emailOk} className={inputClass(tried && !emailOk)} />
                </Field>
              </div>
            </Step>

            <Step n={2} title={t.pickup}>
              <div className="flex items-start gap-3.5 rounded-[22px] bg-sage px-5 py-[18px]">
                <icons.pin size={20} />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{t.shopLine}</span>
                  <span className="text-sm text-[#3C4A42]">{t.openLine.replace("[OPENING HOURS]", hours)}</span>
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="text-sm font-semibold" id="pickup-label">
                  {t.when}
                </span>
                <div role="radiogroup" aria-labelledby="pickup-label" className="flex flex-wrap gap-2.5">
                  {days.today && <Pill checked={choice === "today"} onClick={() => setDayChoice("today")}>{t.today}</Pill>}
                  {days.tomorrow && <Pill checked={choice === "tomorrow"} onClick={() => setDayChoice("tomorrow")}>{t.tomorrow}</Pill>}
                  {days.later.length > 0 && <Pill checked={choice === "later"} onClick={() => setDayChoice("later")}>{t.anotherDay}</Pill>}
                </div>
                {choice === "later" && days.later.length > 0 && (
                  <label className="flex max-w-[360px] flex-col gap-2 text-sm font-semibold">
                    {t.chooseDay}
                    <Select
                      value={laterDay || days.later[0]}
                      onChange={setLaterDay}
                      options={days.later.map((d) => ({ value: d, label: dayLabel(d) }))}
                      className={inputClass(false)}
                    />
                  </label>
                )}
              </div>
            </Step>

            <Step n={3} title={t.payment}>
              <div role="radiogroup" aria-label={t.payment} className="flex flex-col gap-3">
                {mobileEnabled && (
                  <PayCard checked={payChoice === "mobile"} onClick={() => setPay("mobile")} label={t.mobileMoney} note={t.mobileMoneyNote} />
                )}
                {methods?.pay_at_pickup.enabled && (
                  <PayCard checked={payChoice === "pickup"} onClick={() => setPay("pickup")} label={t.atPickup} note={t.atPickupNote} />
                )}
              </div>
              {payChoice === "mobile" && (
                <div className="flex flex-col gap-3.5">
                  <div className="flex flex-col gap-2.5">
                    <span className="text-sm font-semibold" id="network-label">
                      {t.network}
                    </span>
                    <div role="radiogroup" aria-labelledby="network-label" className="flex flex-wrap gap-2.5">
                      {methods?.momo.enabled && <Pill checked={networkChoice === "momo"} onClick={() => setNetwork("momo")}>{t.mtn}</Pill>}
                      {methods?.airtel.enabled && <Pill checked={networkChoice === "airtel"} onClick={() => setNetwork("airtel")}>{t.airtel}</Pill>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5 rounded-card-sm bg-butter px-5 py-[18px] text-[15px]">
                    <span className="font-semibold">{t.howToPay}</span>
                    <span>{t.stepPlace}</span>
                    <span>{t.stepPay(code, formatRwf(total))}</span>
                    <span>{t.stepId}</span>
                  </div>
                </div>
              )}
            </Step>
          </div>

          <aside className="flex flex-[1_1_340px] flex-col gap-4 rounded-[32px] bg-white p-7">
            <h2 className="m-0 font-heading text-[28px] font-medium">{t.yourOrder}</h2>
            {quote.data?.lines.map((l) => (
              <div key={`${l.product_id}:${l.variant_id}`} className="flex items-center gap-3">
                <ProductArt image={l.image} tint={l.tint} categorySlug={l.category_slug} className="size-14 shrink-0 rounded-2xl" iconSize={22} />
                <span className="flex-1 text-sm">
                  <span className="block font-semibold">{l.name}</span>
                  <span className="text-muted">
                    {t.qty(l.qty)}
                    {l.variant_name && ` · ${l.variant_name}`}
                  </span>
                  {l.problem && <span className="block font-semibold text-error">{l.problem}</span>}
                </span>
                <span className="text-sm font-semibold">{formatRwf(l.line_total_rwf)}</span>
              </div>
            ))}
            <div className="flex flex-col gap-2.5 border-t border-[#EEEBE4] pt-4 text-[15px]">
              <div className="flex justify-between">
                <span className="text-muted">{t.subtotal}</span>
                <span>{formatRwf(total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t.pickup}</span>
                <span className="font-semibold text-[#2F6B45]">{strings.shop.bag.free}</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between border-t border-[#EEEBE4] pt-4">
              <span className="font-semibold">{strings.shop.bag.total}</span>
              <Price amount={total} className="text-[28px]" />
            </div>
            <button
              type="button"
              onClick={onPlace}
              disabled={place.isPending || (quote.data && !quote.data.can_checkout)}
              className="min-h-14 cursor-pointer rounded-full bg-ink text-base font-semibold text-white disabled:cursor-default disabled:opacity-50"
            >
              {place.isPending ? t.placing : t.placeOrder}
            </button>
            {tried && !valid && (
              <span role="alert" className="text-sm text-error">
                {t.fixDetails}
              </span>
            )}
            {placeError && (
              <span role="alert" className="text-sm text-error">
                {placeError}{" "}
                {place.error instanceof ApiError && place.error.code === "bag_changed" && (
                  <Link to="/cart" className="font-semibold underline">
                    {t.back}
                  </Link>
                )}
              </span>
            )}
            <p className="m-0 text-xs leading-relaxed text-muted">{t.terms}</p>
          </aside>
        </div>
      </section>
    </div>
  );
}

const inputClass = (invalid: boolean) =>
  `min-h-[52px] w-full rounded-2xl bg-white px-4 text-base font-medium text-ink ${
    invalid ? "border-[1.5px] border-error" : "border border-line"
  }`;

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 rounded-[32px] bg-white p-6 sm:p-8">
      <div className="flex items-center gap-3.5">
        <span className="flex size-9 items-center justify-center rounded-full bg-ink font-bold text-white">{n}</span>
        <h2 className="m-0 font-heading text-[28px] font-medium">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, error, children }: { label: React.ReactNode; error: string | null; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm font-semibold">
      {label}
      {children}
      {error && <span className="text-[13px] font-medium text-error">{error}</span>}
    </label>
  );
}

function Pill({ checked, onClick, children }: { checked: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={`min-h-12 cursor-pointer rounded-full border px-5 text-[15px] font-semibold ${
        checked ? "border-ink bg-ink text-white" : "border-line bg-white text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function PayCard({ checked, onClick, label, note }: { checked: boolean; onClick: () => void; label: string; note: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-4 rounded-[22px] px-5 py-[18px] text-left ${
        checked ? "border-2 border-ink bg-paper" : "border border-line bg-white"
      }`}
    >
      <span className={`size-[22px] shrink-0 rounded-full ${checked ? "border-[7px] border-ink" : "border-[1.5px] border-[#A9B3AC]"}`} />
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-base font-semibold">{label}</span>
        <span className="text-sm font-normal text-muted">{note}</span>
      </span>
    </button>
  );
}
