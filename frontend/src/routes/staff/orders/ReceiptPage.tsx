// Printable receipt. Sized for an 80 mm receipt printer and still readable on A4 (the printer model is an
// open question in HANDOFF.md). Opens in its own tab and starts the print dialog.

import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { formatDateTime, formatPhone, formatRwf } from "../../../lib/format";
import { strings } from "../../../strings";
import { useReceipt } from "./ordersApi";

export function ReceiptPage() {
  const { orderId = "" } = useParams();
  const receipt = useReceipt(orderId);
  const r = receipt.data;

  useEffect(() => {
    if (r) {
      const timer = setTimeout(() => window.print(), 300);
      return () => clearTimeout(timer);
    }
  }, [r]);

  if (!r) return <p className="p-6">{strings.staff.loading}</p>;
  return (
    <div className="min-h-screen bg-white print:min-h-0">
      <style>{"@page { size: 80mm auto; margin: 4mm; }"}</style>
      <div className="mx-auto w-full max-w-[72mm] py-6 font-mono text-[12px] leading-snug text-black print:py-0">
        <div className="text-center">
          <div className="font-heading text-xl font-bold">{r.shop.name}</div>
          <div>{r.shop.address}</div>
          {r.shop.phone && <div>{formatPhone(r.shop.phone)}</div>}
          {r.show_tin && r.tin && <div>TIN {r.tin}</div>}
        </div>
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between">
          <span>{r.number}</span>
          <span>{formatDateTime(r.placed_at)}</span>
        </div>
        <div>{r.customer}</div>
        {r.served_by && <div>Served by {r.served_by}</div>}
        <hr className="my-2 border-dashed border-black" />
        {r.lines.map((l) => (
          <div key={l.id} className="mb-1">
            <div>
              {l.name}
              {l.variant_name && ` (${l.variant_name})`}
            </div>
            <div className="flex justify-between">
              <span>
                {l.qty} × {formatRwf(l.unit_price_rwf)}
              </span>
              <span>{formatRwf(l.line_total_rwf)}</span>
            </div>
          </div>
        ))}
        <hr className="my-2 border-dashed border-black" />
        <div className="flex justify-between text-sm font-bold">
          <span>{strings.orders.total}</span>
          <span>{formatRwf(r.total_rwf)}</span>
        </div>
        <div>{r.payment}</div>
        <hr className="my-2 border-dashed border-black" />
        <div className="text-center">{r.footer}</div>
        {r.returns_policy && <div className="mt-1 text-center text-[10px]">{r.returns_policy}</div>}
        <button type="button" onClick={() => window.print()} className="mt-6 w-full cursor-pointer rounded-full bg-ink py-3 font-body text-sm font-semibold text-white print:hidden">
          {strings.sale.print}
        </button>
      </div>
    </div>
  );
}
