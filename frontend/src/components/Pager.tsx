// Previous / "31–60 of 142" / Next under a long list. Hidden when everything fits on one page.

import { useRef } from "react";
import { icons } from "./icons";
import { strings } from "../strings";

const t = strings.pager;
const button =
  "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-white px-4 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40";

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
  const nav = useRef<HTMLElement>(null);
  if (total <= pageSize) return null;
  // Bring the top of the list back into view, so the new page is read from its first row.
  const go = (next: number) => {
    onPage(next);
    const list = nav.current?.parentElement;
    if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: "start" });
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav ref={nav} aria-label={t.label} className="flex items-center justify-between gap-3 px-1 py-3">
      <button type="button" className={button} disabled={page <= 1} onClick={() => go(page - 1)}>
        <icons.arrowLeft size={16} />
        {t.previous}
      </button>
      <span className="text-sm text-muted" aria-live="polite">{t.range(from, to, total)}</span>
      <button type="button" className={button} disabled={to >= total} onClick={() => go(page + 1)}>
        {t.next}
        <icons.arrowRight size={16} />
      </button>
    </nav>
  );
}
