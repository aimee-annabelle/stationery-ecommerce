// S4 · Products & stock (design/AdminProducts.dc.html).

import { useState } from "react";
import { Link } from "react-router-dom";
import { icons } from "../../../components/icons";
import { formatRwf } from "../../../lib/format";
import { useStaffSession } from "../../../lib/staffSession";
import { strings } from "../../../strings";
import { AddProductPanel } from "./AddProductPanel";
import { useProducts, useUpdateProduct } from "./catalogApi";
import { Pager } from "../../../components/Pager";
import { MovementsTable, ReceivePanel, StockBar, Thumb } from "./parts";

const t = strings.products;
const PAGE_SIZE = 50;

export function ProductsDesktop() {
  const { can } = useStaffSession();
  const canManage = can("products.edit");
  const showCost = can("costs.view");
  const [tab, setTab] = useState<"products" | "moves">("products");
  const [lowOnly, setLowOnly] = useState(false);
  const [panel, setPanel] = useState<"receive" | "add" | null>(null);
  const [page, setPage] = useState(1);
  const products = useProducts({ low: lowOnly, page, page_size: PAGE_SIZE });
  const update = useUpdateProduct();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        {canManage && (
          <Link className="btn btn-quiet btn-small" to="/staff/products/categories">
            {t.categories}
          </Link>
        )}
      </div>

      {!canManage && (
        <div role="note" className="note note-butter">
          <icons.eye size={18} />
          {t.viewOnly}
        </div>
      )}

      <div className="toolbar">
        <div className="pill-row" role="tablist" aria-label="View">
          <button className="pill" role="tab" aria-selected={tab === "products"} onClick={() => setTab("products")}>
            {t.tabProducts}
          </button>
          <button className="pill" role="tab" aria-selected={tab === "moves"} onClick={() => setTab("moves")}>
            {t.tabMoves}
          </button>
          {tab === "products" && (
            <button
              className="pill pill-warn"
              aria-pressed={lowOnly}
              onClick={() => {
                setLowOnly(!lowOnly);
                setPage(1);
              }}
            >
              {t.lowOnly}
            </button>
          )}
        </div>
        {canManage && (
          <div className="pill-row">
            {can("stock.manage") && (
              <button className="btn btn-outline" type="button" onClick={() => setPanel(panel === "receive" ? null : "receive")}>
                {t.receive}
              </button>
            )}
            <button className="btn btn-primary" type="button" onClick={() => setPanel(panel === "add" ? null : "add")}>
              <icons.plus size={16} />
              {t.add}
            </button>
          </div>
        )}
      </div>

      {panel === "receive" && <ReceivePanel />}
      {panel === "add" && <AddProductPanel onClose={() => setPanel(null)} />}

      {tab === "moves" ? (
        <MovementsTable showCost={showCost} />
      ) : (
        <div className="table-card">
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>{t.columns.product}</th>
                <th>{t.columns.category}</th>
                <th>{t.columns.price}</th>
                {showCost && <th>{t.columns.cost}</th>}
                <th>{t.columns.stock}</th>
                <th>{t.columns.inShop}</th>
                {canManage && (
                  <th>
                    <span className="visually-hidden">{t.columns.edit}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {products.data?.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="product-cell">
                      <Thumb product={p} />
                      <span>
                        <span className="product-name">{p.name}</span>
                        <span className="product-sku">{p.sku}</span>
                      </span>
                    </span>
                  </td>
                  <td>{p.category.name}</td>
                  <td className="nowrap" style={{ fontWeight: 600 }}>
                    {formatRwf(p.price_rwf)}
                  </td>
                  {showCost && <td className="nowrap muted">{p.cost_rwf != null ? formatRwf(p.cost_rwf) : ""}</td>}
                  <td>
                    <StockBar product={p} />
                  </td>
                  <td>
                    {canManage ? (
                      <button
                        className="switch"
                        type="button"
                        role="switch"
                        aria-checked={p.is_visible}
                        aria-label={t.showInShop(p.name)}
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: p.id, is_visible: !p.is_visible })}
                      >
                        <span />
                      </button>
                    ) : (
                      <span style={{ fontSize: 13 }}>{p.is_visible ? t.visible : t.hidden}</span>
                    )}
                  </td>
                  {canManage && (
                    <td style={{ textAlign: "right" }}>
                      <Link className="btn btn-quiet btn-small" to={`/staff/products/${p.id}`}>
                        {t.edit}
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {products.data?.items.length === 0 && <p className="empty">{t.empty}</p>}
          {products.data && (
            <Pager page={page} pageSize={PAGE_SIZE} total={products.data.total} onPage={setPage} />
          )}
        </div>
      )}
    </>
  );
}
