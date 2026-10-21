// M4 · Product lookup on a phone (design/MobileProducts.dc.html).
// Workers see it view-only. Managers and the owner also get Edit and Receive stock.

import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { icons } from "../../../components/icons";
import { formatRwf } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staffSession";
import { strings } from "../../../strings";
import { type Product, useCategories, useFlagLowStock, useProducts } from "./catalogApi";
import { errorText, ReceivePanel, Thumb } from "./parts";
import "./lookup.css";

const t = strings.lookup;

export function ProductLookup() {
  const { can } = useStaffSession();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const query = useDeferredValue(q.trim());
  const categories = useCategories();
  const products = useProducts({ q: query || undefined, category_id: categoryId || undefined, page_size: 200 });
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="lookup">
      <header className="lookup-head">
        <div className="lookup-title">
          <h1>{t.title}</h1>
          {!can("products.edit") && <span className="lookup-badge">{t.viewOnly}</span>}
        </div>
        <label className="lookup-search">
          <icons.search size={18} />
          <span className="visually-hidden">{t.search}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.searchPlaceholder} />
        </label>
        <div className="lookup-chips">
          <button className="chip" aria-pressed={categoryId === ""} onClick={() => setCategoryId("")}>
            {t.all}
          </button>
          {categories.data?.map((c) => (
            <button key={c.id} className="chip" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </header>

      <div className="lookup-list">
        {products.data?.items.map((p) => (
          <LookupRow key={p.id} product={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
        ))}
        {products.data?.items.length === 0 && <div className="empty">{t.empty}</div>}
      </div>
    </div>
  );
}

function LookupRow({ product: p, open, onToggle }: { product: Product; open: boolean; onToggle: () => void }) {
  const { can } = useStaffSession();
  const flag = useFlagLowStock();
  const [receiving, setReceiving] = useState(false);

  const flagMessage = flag.data
    ? flag.data.already_flagged
      ? t.alreadyFlagged(flag.data.flagged_by)
      : t.flagged(flag.data.notified)
    : p.low_stock_flag
      ? t.alreadyFlagged(p.low_stock_flag.flagged_by)
      : null;

  return (
    <div className="lookup-row">
      <button className="lookup-toggle" type="button" aria-expanded={open} onClick={onToggle}>
        <Thumb product={p} size={44} />
        <span className="lookup-name">
          <span>{p.name}</span>
          <span className="lookup-price">{formatRwf(p.price_rwf)}</span>
        </span>
        <span className={`lookup-stock${p.is_low ? " low" : ""}`}>{t.left(p.stock_qty)}</span>
      </button>
      {open && (
        <div className="lookup-detail">
          <div className="lookup-facts">
            <span>
              <span>{t.where}</span>
              <strong>{p.location ?? t.notSet}</strong>
            </span>
            <span>
              <span>{t.code}</span>
              <strong>{p.sku}</strong>
            </span>
            <span>
              <span>{t.alertAt}</span>
              <strong>{p.low_stock_alert}</strong>
            </span>
          </div>
          {p.variants.length > 0 && (
            <div className="lookup-variants">
              {p.variants.map((v) => (
                <span key={v.id}>
                  {v.swatch_hex && <i style={{ background: v.swatch_hex }} aria-hidden="true" />}
                  {v.name}: <strong>{v.stock_qty}</strong>
                </span>
              ))}
            </div>
          )}
          {p.is_low &&
            (flagMessage ? (
              <span role="status" className="lookup-flagged">
                {flagMessage}
              </span>
            ) : (
              <button className="lookup-flag" type="button" disabled={flag.isPending} onClick={() => flag.mutate(p.id)}>
                {t.flag}
              </button>
            ))}
          {flag.error && <p role="alert" className="form-error">{errorText(flag.error)}</p>}
          {can("stock.manage") && receiving && <ReceivePanel fixedProduct={p} onDone={() => setReceiving(false)} />}
          <div className="lookup-actions">
            {can("products.edit") && (
              <Link className="btn btn-quiet" to={`/staff/products/${p.id}`}>
                {t.edit}
              </Link>
            )}
            {can("stock.manage") && !receiving && (
              <button className="btn btn-outline" type="button" onClick={() => setReceiving(true)}>
                {strings.products.receive}
              </button>
            )}
            <Link className="btn btn-primary lookup-sell" to={`/staff/sale?product=${p.id}`}>
              {t.sell}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
