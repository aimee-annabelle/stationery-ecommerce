// The guest bag, kept in this browser (HANDOFF.md: "stored in the browser for guests"). It holds only
// product IDs and quantities; prices always come from the server (/cart/quote).

import { useSyncExternalStore } from "react";

export type BagLine = { productId: string; variantId: string | null; qty: number };

const KEY = "pahyems.bag.v1";
const ORDER_KEY = (number: string) => `pahyems.order.${number}`;
const listeners = new Set<() => void>();
const changeListeners = new Set<(lines: BagLine[]) => void>();
let lines: BagLine[] = read();

function read(): BagLine[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((l) => typeof l?.productId === "string" && Number.isInteger(l?.qty) && l.qty > 0)
      : [];
  } catch {
    return [];
  }
}

function write(next: BagLine[], { silent = false } = {}) {
  lines = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private windows can refuse storage; the bag still works until the tab closes.
  }
  listeners.forEach((listener) => listener());
  if (!silent) changeListeners.forEach((listener) => listener(next));
}

/** Changes made in this tab (used to save a signed-in customer's bag to the server). */
export function onBagChange(listener: (lines: BagLine[]) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

// Another tab changed the bag.
window.addEventListener("storage", (event) => {
  if (event.key === KEY) {
    lines = read();
    listeners.forEach((listener) => listener());
  }
});

const same = (a: BagLine, productId: string, variantId: string | null) =>
  a.productId === productId && a.variantId === variantId;

export const bag = {
  add(productId: string, variantId: string | null, qty = 1) {
    const existing = lines.find((l) => same(l, productId, variantId));
    write(
      existing
        ? lines.map((l) => (l === existing ? { ...l, qty: Math.min(99, l.qty + qty) } : l))
        : [...lines, { productId, variantId, qty }],
    );
  },
  setQty(productId: string, variantId: string | null, qty: number) {
    write(
      qty <= 0
        ? lines.filter((l) => !same(l, productId, variantId))
        : lines.map((l) => (same(l, productId, variantId) ? { ...l, qty: Math.min(99, qty) } : l)),
    );
  },
  clear() {
    write([]);
  },
  snapshot(): BagLine[] {
    return lines.map((l) => ({ ...l }));
  },
  /** Replaces the whole bag, for example with the account's bag after signing in. */
  replace(next: BagLine[], options: { silent?: boolean } = {}) {
    write(next, options);
  },
};

export function useBag(): BagLine[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => lines,
  );
}

export const bagUnits = (items: BagLine[]) => items.reduce((sum, l) => sum + l.qty, 0);

// The confirmation page shows the order only in the tab that placed it, because order numbers count up
// and could otherwise be guessed. Elsewhere, customers look it up with their phone number.
export const placedOrders = {
  save(number: string, order: unknown) {
    try {
      sessionStorage.setItem(ORDER_KEY(number), JSON.stringify(order));
    } catch {
      /* ignore */
    }
  },
  load<T>(number: string): T | null {
    try {
      const raw = sessionStorage.getItem(ORDER_KEY(number));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
};
