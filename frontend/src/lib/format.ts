// Display formats from HANDOFF.md: "12,500 RWF", Africa/Kigali time, "07XX XXX XXX".

export function formatRwf(amount: number): string {
  return `${amount.toLocaleString("en-US")} RWF`;
}

export function formatPhone(stored: string): string {
  // Stored as 2507XXXXXXXX.
  const local = `0${stored.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

const kigaliDateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Kigali",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(iso: string): string {
  return kigaliDateTime.format(new Date(iso));
}
