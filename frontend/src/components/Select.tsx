// Drop-in for <select>: the browser's own option list can't be styled, so this draws its own.
// It follows the ARIA listbox pattern and keeps a hidden input so `required` still blocks a form.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { icons } from "./icons";

export type SelectOption = { value: string; label: string };

/** Trigger look matching the staff `.field` inputs. */
export const fieldTrigger = "min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-medium text-ink";

const GAP = 6;
const EDGE = 8;

export function Select({
  value,
  onChange,
  options,
  placeholder = "—",
  disabled = false,
  required = false,
  className = fieldTrigger,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const selected = options.findIndex((o) => o.value === value);

  const show = (index = selected) => {
    if (disabled || !options.length) return;
    setActive(index < 0 ? 0 : index);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    setPos(null);
    if (refocus) trigger.current?.focus();
  };
  const pick = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close();
  };

  // Place the list under the trigger, or above it when there's more room there.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const wanted = Math.min(288, options.length * 44 + 12);
    const up = below < wanted && above > below;
    const maxHeight = Math.min(288, up ? above : below);
    const width = Math.max(r.width, 160);
    const left = Math.min(Math.max(EDGE, r.left), window.innerWidth - width - EDGE);
    setPos({ top: up ? r.top - GAP - Math.min(wanted, maxHeight) : r.bottom + GAP, left, width, maxHeight });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const moved = (e: Event) => {
      if (!list.current?.contains(e.target as Node)) close(false);
    };
    const resized = () => close(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", resized);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", resized);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((a) => Math.min(last, a + 1)),
      ArrowUp: () => setActive((a) => Math.max(0, a - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => pick(active),
      " ": () => pick(active),
      Escape: () => close(),
      Tab: () => close(),
    };
    if (keys[e.key]) {
      if (e.key !== "Tab") e.preventDefault();
      keys[e.key]();
    } else if (e.key.length === 1) {
      // Typing a letter jumps to the next option that starts with it.
      const ch = e.key.toLowerCase();
      const order = [...options.keys()].map((i) => (active + 1 + i) % options.length);
      const hit = order.find((i) => options[i].label.toLowerCase().startsWith(ch));
      if (hit !== undefined) setActive(hit);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
        className={`${className} inline-flex cursor-pointer items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`truncate ${selected < 0 ? "text-muted" : ""}`}>{selected < 0 ? placeholder : options[selected].label}</span>
        <span className={`flex shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}>
          <icons.chevronDown size={16} />
        </span>
      </button>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => {}}
          onFocus={() => trigger.current?.focus()}
          className="sr-only"
        />
      )}
      {open &&
        createPortal(
          <ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={onListKey}
            style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { top: 0, left: 0, opacity: 0 }}
            className="fixed z-50 m-0 flex list-none flex-col gap-0.5 overflow-y-auto rounded-2xl border border-line bg-white p-1.5 font-body text-ink shadow-[0_12px_32px_rgba(34,48,42,0.14)] outline-none"
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === selected}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-3 text-[15px] ${i === active ? "bg-paper" : ""} ${i === selected ? "font-semibold" : "font-medium"}`}
              >
                <span className="truncate">{o.label}</span>
                {i === selected && (
                  <span className="flex shrink-0">
                    <icons.check size={16} />
                  </span>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
