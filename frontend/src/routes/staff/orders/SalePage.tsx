// M3 · New walk-in sale (design/MobileSale.dc.html), also the "New walk-in order" panel on S2.
// A walk-in is paid on the spot and starts at Collected; stock goes down at once.

import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { icons } from "../../../components/icons";
import { formatRwf } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staffSession";
import { strings } from "../../../strings";
import { type Product, useProducts } from "../products/catalogApi";
import { Thumb } from "../products/parts";
import { errorText } from "./parts";
import { type OrderDetail, useWalkIn, useWhatsApp } from "./ordersApi";

const t = strings.sale;
type Line = { product: Product; variantId: string | null; qty: number };
const key = (productId: string, variantId: string | null) => `${productId}:${variantId ?? ""}`;

function useSale() {
  const [lines, setLines] = useState<Record<string, Line>>({});
  const change = (product: Product, variantId: string | null, delta: number) =>
    setLines((prev) => {
      const k = key(product.id, variantId);
      const qty = (prev[k]?.qty ?? 0) + delta;
      const next = { ...prev };
      if (qty <= 0) delete next[k];
      else next[k] = { product, variantId, qty };
      return next;
    });
  const list = Object.values(lines);
  return {
    lines,
    list,
    change,
    reset: () => setLines({}),
    units: list.reduce((s, l) => s + l.qty, 0),
    total: list.reduce((s, l) => s + l.qty * l.product.price_rwf, 0),
  };
}

function ProductRows({ query, sale }: { query: string; sale: ReturnType<typeof useSale> }) {
  const products = useProducts({ q: query || undefined, page_size: 50 });
  const [choosing, setChoosing] = useState<string | null>(null);
  const items = products.data?.items ?? [];
  if (products.data && items.length === 0) return <p className="py-8 text-center text-sm text-muted">{t.empty}</p>;
  return (
    <>
      {items.map((p) => {
        const plain = p.variants.length === 0;
        const qty = plain ? sale.lines[key(p.id, null)]?.qty ?? 0 : p.variants.reduce((s, v) => s + (sale.lines[key(p.id, v.id)]?.qty ?? 0), 0);
        return (
          <div key={p.id} className="flex flex-col gap-2 rounded-[18px] bg-white py-2.5 pr-2.5 pl-3">
            <div className="flex items-center gap-3">
              <Thumb product={p} size={44} />
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="text-xs text-muted">{t.inStock(formatRwf(p.price_rwf), p.stock_qty)}</span>
              </span>
              {plain && qty > 0 ? (
                <Qty name={p.name} qty={qty} onDec={() => sale.change(p, null, -1)} onInc={() => sale.change(p, null, 1)} max={p.stock_qty} />
              ) : (
                <button
                  type="button"
                  aria-label={t.add(p.name)}
                  disabled={p.stock_qty <= 0}
                  onClick={() => (plain ? sale.change(p, null, 1) : setChoosing(choosing === p.id ? null : p.id))}
                  className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-white disabled:opacity-30"
                >
                  {!plain && qty > 0 ? <span className="text-sm font-bold">{qty}</span> : <icons.plus size={18} />}
                </button>
              )}
            </div>
            {!plain && choosing === p.id && (
              <div className="flex flex-col gap-1.5 pl-14">
                <span className="text-xs font-semibold text-muted">{t.chooseOption}</span>
                {p.variants.map((v) => {
                  const vq = sale.lines[key(p.id, v.id)]?.qty ?? 0;
                  return (
                    <div key={v.id} className="flex items-center gap-2">
                      {v.swatch_hex && <span className="size-4 rounded-full border border-[#CFC9BC]" style={{ background: v.swatch_hex }} />}
                      <span className="flex-1 text-sm">
                        {v.name} <span className="text-xs text-muted">({v.stock_qty})</span>
                      </span>
                      <Qty name={`${p.name} ${v.name}`} qty={vq} onDec={() => sale.change(p, v.id, -1)} onInc={() => sale.change(p, v.id, 1)} max={v.stock_qty} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function Qty({ name, qty, onDec, onInc, max }: { name: string; qty: number; onDec: () => void; onInc: () => void; max: number }) {
  return (
    <span className="flex items-center rounded-full bg-paper-staff">
      <button type="button" aria-label={t.removeOne(name)} disabled={qty <= 0} onClick={onDec} className="size-10 cursor-pointer rounded-full text-lg font-semibold disabled:opacity-30">
        −
      </button>
      <span className="min-w-[22px] text-center font-bold">{qty}</span>
      <button type="button" aria-label={t.addOne(name)} disabled={qty >= max} onClick={onInc} className="size-10 cursor-pointer rounded-full text-lg font-semibold disabled:opacity-30">
        +
      </button>
    </span>
  );
}

function Done({ order, onAgain }: { order: OrderDetail; onAgain: () => void }) {
  const { staff } = useStaffSession();
  const whatsapp = useWhatsApp();
  const pay = order.paid_with === "cash" ? strings.orders.cash : strings.orders.mobileMoney;
  const button = "min-h-[52px] w-full cursor-pointer rounded-2xl text-[15px] font-semibold flex items-center justify-center no-underline";
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3.5 p-6 text-center">
      <span className="flex size-24 items-center justify-center rounded-full bg-ink text-white">
        <icons.check size={40} />
      </span>
      <span className="font-heading text-[30px] font-semibold">{t.doneTitle}</span>
      <span className="text-[15px] text-[#3C4A42]">{t.done(order.number, formatRwf(order.total_rwf), pay)}</span>
      <span className="text-[13px] text-muted">{t.recordedAs(staff?.name ?? "")}</span>
      <div className="mt-3 flex w-full max-w-[360px] flex-col gap-2.5">
        <Link to={`/staff/orders/${order.id}/receipt`} target="_blank" className={`${button} border-[1.5px] border-ink bg-white`}>
          {t.print}
        </Link>
        <button type="button" onClick={() => whatsapp.mutate({ id: order.id, template: "receipt" })} className={`${button} border-[1.5px] border-ink bg-white`}>
          {t.whatsapp}
        </button>
        <button type="button" onClick={onAgain} className={`${button} bg-ink text-white`}>
          {t.another}
        </button>
      </div>
    </div>
  );
}

/** Full-page M3 (phone and /staff/sale on desktop). */
export function SalePage() {
  const sale = useSale();
  const walkIn = useWalkIn();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [paidWith, setPaidWith] = useState<"cash" | "mobile_money">("cash");
  const [done, setDone] = useState<OrderDetail | null>(null);

  if (done) return <Done order={done} onAgain={() => { setDone(null); sale.reset(); walkIn.reset(); }} />;

  const pill = (on: boolean) =>
    `min-h-[46px] flex-1 cursor-pointer rounded-[14px] text-sm font-semibold ${on ? "bg-white text-ink" : "border border-white/35 bg-transparent text-white"}`;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col">
      <header className="flex flex-col gap-3 pt-6 pb-3">
        <h1 className="m-0 font-heading text-[26px] font-semibold">{t.title}</h1>
        <label className="flex min-h-[50px] items-center gap-2.5 rounded-2xl bg-white px-3.5 text-muted focus-within:outline-2 focus-within:outline-ink">
          <icons.search size={18} />
          <span className="sr-only">{t.search}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] font-medium text-ink outline-none" />
        </label>
      </header>
      <div className="flex flex-col gap-2 pb-3">
        <ProductRows query={query} sale={sale} />
      </div>
      {sale.units > 0 && (
        <div className="sticky bottom-[96px] z-[5] flex flex-col gap-3 rounded-[24px] bg-ink p-4 text-white md:bottom-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-[#CFDCD3]">{t.count(sale.units)}</span>
            <span className="font-heading text-[26px] font-semibold">{formatRwf(sale.total)}</span>
          </div>
          <div role="radiogroup" aria-label={t.payment} className="flex gap-2">
            <button type="button" role="radio" aria-checked={paidWith === "cash"} onClick={() => setPaidWith("cash")} className={pill(paidWith === "cash")}>
              {strings.orders.cash}
            </button>
            <button type="button" role="radio" aria-checked={paidWith === "mobile_money"} onClick={() => setPaidWith("mobile_money")} className={pill(paidWith === "mobile_money")}>
              {strings.orders.mobileMoney}
            </button>
          </div>
          {walkIn.error && <span role="alert" className="text-sm text-blush">{errorText(walkIn.error)}</span>}
          <button
            type="button"
            disabled={walkIn.isPending}
            onClick={() =>
              walkIn.mutate(
                { items: sale.list.map((l) => ({ product_id: l.product.id, variant_id: l.variantId, qty: l.qty })), paid_with: paidWith },
                { onSuccess: setDone },
              )
            }
            className="min-h-[54px] cursor-pointer rounded-[18px] bg-sage text-base font-semibold text-ink disabled:opacity-60"
          >
            {t.complete}
          </button>
        </div>
      )}
    </div>
  );
}

/** "New walk-in order" panel on S2, with the optional name and phone from the design. */
export function WalkInPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (order: OrderDetail) => void }) {
  const sale = useSale();
  const walkIn = useWalkIn();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [paidWith, setPaidWith] = useState<"cash" | "mobile_money">("cash");
  const query = useDeferredValue(q.trim());
  const field = "min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-medium";
  const summary = useMemo(() => sale.list.map((l) => `${l.qty} × ${l.product.name}`).join(", "), [sale.list]);

  return (
    <div className="flex flex-col gap-4 rounded-3xl border-2 border-ink bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="m-0 font-body text-lg font-bold">{strings.orders.newWalkIn}</h2>
        <button type="button" aria-label={strings.products.form.close} onClick={onClose} className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-paper-staff">
          <icons.close size={14} />
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          {t.name}
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          {t.phone}
          <input className={field} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phonePlaceholder} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          {strings.sale.search}
          <input className={field} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} />
        </label>
      </div>
      {query && (
        <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto rounded-2xl bg-paper-staff p-2">
          <ProductRows query={query} sale={sale} />
        </div>
      )}
      {summary && <p className="m-0 text-sm text-muted">{summary}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] font-semibold">{t.payment}</span>
        {(["cash", "mobile_money"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={paidWith === m}
            onClick={() => setPaidWith(m)}
            className={`min-h-[42px] cursor-pointer rounded-full px-4 text-[13px] font-semibold ${paidWith === m ? "bg-ink text-white" : "border border-line bg-white"}`}
          >
            {m === "cash" ? strings.orders.cash : strings.orders.mobileMoney}
          </button>
        ))}
        <span className="flex-1" />
        <span className="font-heading text-xl font-semibold">{formatRwf(sale.total)}</span>
        <button
          type="button"
          disabled={sale.units === 0 || walkIn.isPending}
          onClick={() =>
            walkIn.mutate(
              {
                items: sale.list.map((l) => ({ product_id: l.product.id, variant_id: l.variantId, qty: l.qty })),
                paid_with: paidWith,
                name: name.trim() || undefined,
                phone: phone.trim() || undefined,
              },
              { onSuccess: onCreated },
            )
          }
          className="min-h-[46px] cursor-pointer rounded-full bg-ink px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {t.create}
        </button>
      </div>
      {walkIn.error && <p role="alert" className="m-0 text-sm text-error">{errorText(walkIn.error)}</p>}
    </div>
  );
}
