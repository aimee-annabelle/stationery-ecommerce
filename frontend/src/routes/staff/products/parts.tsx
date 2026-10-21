// Pieces shared by S4 (desktop), M4 (phone) and the product edit page.

import { useState } from "react";
import { ApiError } from "../../../lib/api";
import { formatDateTime, formatRwf } from "../../../lib/format";
import { strings } from "../../../strings";
import {
  type Movement,
  type Product,
  tintVar,
  useCategories,
  useMovements,
  useProducts,
  useReceiveStock,
} from "./catalogApi";

const t = strings.products;

export function errorText(error: unknown): string | null {
  if (!error) return null;
  return error instanceof ApiError ? error.message : strings.genericError;
}

/** Whole RWF amounts or counts from a number input. Empty means null. */
export function toInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function Thumb({ product, size = 40 }: { product: Product; size?: number }) {
  const cover = product.images[0];
  const style = { width: size, height: size, background: tintVar(product.category.tint) };
  return cover ? <img className="thumb" src={cover.url} alt="" style={style} /> : <span className="thumb" style={style} />;
}

export function StockBar({ product }: { product: Product }) {
  // Same scale as the design: a full bar is three times the alert level.
  const alert = Math.max(product.low_stock_alert, 1);
  const width = Math.min(100, Math.max(6, Math.round((product.stock_qty / (alert * 3)) * 100)));
  return (
    <span className="stock-cell">
      <span className="stock-num">{product.stock_qty}</span>
      <span className="stock-track">
        <span className={`stock-bar${product.is_low ? " low" : ""}`} style={{ width: `${width}%` }} />
      </span>
      {product.is_low && <span className="low-tag">{t.low}</span>}
    </span>
  );
}

export function CategorySelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const categories = useCategories();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>
        —
      </option>
      {categories.data?.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** "Receive stock" panel (S4). With `fixedProduct`, it is for one product (edit page). */
export function ReceivePanel({ fixedProduct, onDone }: { fixedProduct?: Product; onDone?: () => void }) {
  const r = t.receiveForm;
  const all = useProducts({ page_size: 200 });
  const receive = useReceiveStock();
  const [productId, setProductId] = useState(fixedProduct?.id ?? "");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState("1");
  const [supplier, setSupplier] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const product = fixedProduct ?? all.data?.items.find((p) => p.id === productId);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const amount = toInt(qty);
    if (!product || !amount || amount <= 0) return;
    receive.mutate(
      {
        product_id: product.id,
        variant_id: variantId || undefined,
        qty: amount,
        supplier: supplier.trim() || undefined,
        unit_cost_rwf: toInt(unitCost) ?? undefined,
      },
      {
        onSuccess: () => {
          setDone(r.done(amount, product.name));
          setQty("1");
          setSupplier("");
          setUnitCost("");
          onDone?.();
        },
      },
    );
  };

  return (
    <form className="panel" onSubmit={onSubmit}>
      <h2>{r.title}</h2>
      <div className="form-row">
        {!fixedProduct && (
          <label className="field" style={{ flex: "2 1 240px" }}>
            {r.product}
            <select
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setVariantId("");
              }}
              required
            >
              <option value="" disabled>
                —
              </option>
              {all.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {product && product.variants.length > 0 && (
          <label className="field" style={{ flex: "1 1 160px" }}>
            {r.option}
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
              <option value="" disabled>
                {r.chooseOption}
              </option>
              {product.variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field" style={{ flex: "1 1 120px" }}>
          {r.qty}
          <input type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </label>
        <label className="field" style={{ flex: "1 1 180px" }}>
          {r.supplier}
          <input type="text" placeholder={r.supplierPlaceholder} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </label>
        <label className="field" style={{ flex: "1 1 140px" }}>
          {r.unitCost}
          <input type="number" min={0} inputMode="numeric" placeholder="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={receive.isPending}>
          {r.submit}
        </button>
      </div>
      {receive.error && <p role="alert" className="form-error">{errorText(receive.error)}</p>}
      {done && !receive.error && <p role="status" className="note note-sage">{done}</p>}
    </form>
  );
}

function reasonLabel(m: Movement): string {
  const base = t.moves.reasons[m.reason] ?? m.reason;
  const detail = m.order_number ? t.moves.order(m.order_number) : m.supplier || m.note;
  return detail ? `${base} · ${detail}` : base;
}

/** Stock movements table (S4 "Stock movements" tab and the edit page history). */
export function MovementsTable({ productId, showCost }: { productId?: string; showCost: boolean }) {
  const [page, setPage] = useState(1);
  const movements = useMovements(productId, page);
  const data = movements.data;
  if (!data) return <p className="empty">{strings.staff.loading}</p>;
  if (data.items.length === 0) return <p className="empty">{t.moves.empty}</p>;

  return (
    <div className="table-card">
      <table className="table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>{t.moves.when}</th>
            {!productId && <th>{t.moves.product}</th>}
            <th>{t.moves.change}</th>
            <th>{t.moves.reason}</th>
            {showCost && <th>{t.moves.unitCost}</th>}
            <th>{t.moves.by}</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((m) => (
            <tr key={m.id}>
              <td className="nowrap muted">{formatDateTime(m.at)}</td>
              {!productId && (
                <td style={{ fontWeight: 600 }}>
                  {m.product_name}
                  {m.variant_name && <span className="product-sku"> · {m.variant_name}</span>}
                </td>
              )}
              <td className={m.change_qty > 0 ? "change-up" : "change-down"}>
                {m.change_qty > 0 ? `+${m.change_qty}` : `−${Math.abs(m.change_qty)}`}
                {productId && m.variant_name && <span className="product-sku"> {m.variant_name}</span>}
              </td>
              <td>{reasonLabel(m)}</td>
              {showCost && <td className="nowrap muted">{m.unit_cost_rwf != null ? formatRwf(m.unit_cost_rwf) : ""}</td>}
              <td>{m.by}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />
    </div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <button className="btn btn-quiet btn-small" type="button" disabled={page === 1} onClick={() => onPage(page - 1)}>
        {t.previous}
      </button>
      <span>{t.page(from, to, total)}</span>
      <button className="btn btn-quiet btn-small" type="button" disabled={to >= total} onClick={() => onPage(page + 1)}>
        {t.next}
      </button>
    </div>
  );
}
