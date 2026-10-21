// S3 · Print requests (design/AdminRequests.dc.html) and, on a phone, M5 (design/MobileRequests.dc.html).

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { icons } from "../../../components/icons";
import { ApiError } from "../../../lib/api";
import { formatRwf } from "../../../lib/format";
import { staffApi, staffDownload } from "../../../lib/staffSession";
import { useIsPhone } from "../../../lib/useMediaQuery";
import { strings } from "../../../strings";
import { Select } from "../../../components/Select";

const t = strings.requests;
const STAGES = ["new", "quoted", "in_progress", "ready", "collected"] as const;
const COLLECTED_STEP = 20;
const DOT: Record<string, string> = { new: "bg-[#8A79B8]", quoted: "bg-[#C9A227]", in_progress: "bg-terracotta", ready: "bg-[#3E6B52]", collected: "bg-[#8C8C86]" };
const TAG: Record<string, string> = { invitations: "bg-blush", binding: "bg-sage" };

type Request = {
  id: string;
  number: string;
  type: "invitations" | "binding";
  summary: string;
  details: Record<string, unknown>;
  status: (typeof STAGES)[number];
  customer: string;
  phone: string | null;
  email: string | null;
  has_account: boolean;
  needed_by: string | null;
  quote_rwf: number | null;
  ready_on: string | null;
  assigned_to: string | null;
  assigned_staff_id: string | null;
  paid_with: string | null;
  files: { id: string; filename: string; content_type: string; size_bytes: number }[];
  history: { status: string; event: string | null; note: string | null; who: string; at: string }[];
};
type Board = { items: Request[]; counts: Record<string, number>; staff: { id: string; name: string; role: string }[] };

const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)) : "—");
const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Kigali", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? strings.genericError : null);
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const kigaliToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali" }).format(new Date());

/** Open work comes in full; the Collected column shows the newest `collected` and grows on request. */
function useBoard(collected = COLLECTED_STEP) {
  return useQuery({
    queryKey: ["staff", "requests", "board", collected],
    queryFn: () => staffApi<Board>(`/staff/print-requests?collected_limit=${collected}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}
function useRequest(id?: string) {
  return useQuery({ queryKey: ["staff", "requests", id], queryFn: () => staffApi<Request>(`/staff/print-requests/${id}`), enabled: !!id });
}
function useRequestMutation<T>(request: (args: T) => Promise<Request>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (r) => {
      client.setQueryData(["staff", "requests", r.id], r);
      client.invalidateQueries({ queryKey: ["staff", "requests", "board"] });
      client.invalidateQueries({ queryKey: ["staff", "dashboard"] });
    },
  });
}

/** Opens WhatsApp first (so phone browsers don't block the new tab), then fills in the link. */
async function openWhatsApp(id: string, template: "quote" | "ready" | "general") {
  const tab = window.open("", "_blank");
  try {
    const { url } = await staffApi<{ url: string }>(`/staff/print-requests/${id}/whatsapp-link`, json("POST", { template }));
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (error) {
    tab?.close();
    throw error;
  }
}

export function RequestsPage() {
  const { requestId } = useParams();
  const isPhone = useIsPhone();
  if (isPhone) return requestId ? <MobileDetail id={requestId} /> : <MobileList />;
  return <DesktopBoard selectedId={requestId} />;
}

function Card({ r, selected, to }: { r: Request; selected?: boolean; to: string }) {
  return (
    <Link to={to} className={`flex flex-col gap-2 rounded-[18px] bg-white p-3.5 no-underline ${selected ? "outline-2 outline-ink" : ""}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{r.number}</span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TAG[r.type]}`}>{t.type[r.type]}</span>
      </span>
      <span className="text-sm font-semibold">{r.customer}</span>
      <span className="text-[13px] text-muted">{r.summary}</span>
      <span className="flex justify-between text-xs text-muted">
        <span>{t.due(day(r.needed_by))}</span>
        <span>{r.quote_rwf != null ? formatRwf(r.quote_rwf) : r.assigned_to ?? t.unassigned}</span>
      </span>
    </Link>
  );
}

function DesktopBoard({ selectedId }: { selectedId?: string }) {
  const [collected, setCollected] = useState(COLLECTED_STEP);
  const board = useBoard(collected);
  const [adding, setAdding] = useState(false);
  const items = board.data?.items ?? [];
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <button type="button" onClick={() => setAdding(!adding)} className="flex min-h-[46px] cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-sm font-semibold text-white">
          <icons.plus size={16} />
          {t.add}
        </button>
      </div>
      {adding && <NewRequestForm onDone={() => setAdding(false)} />}
      <div className="flex flex-wrap items-start gap-4">
        <div className="grid min-w-0 flex-[2_1_640px] grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          {STAGES.map((stage) => {
            const column = items.filter((r) => r.status === stage);
            return (
              <div key={stage} className="flex flex-col gap-2.5 rounded-3xl bg-[#EAE6DD] p-3">
                <span className="flex items-center gap-2 px-1 text-[13px] font-semibold">
                  <span className={`size-2.5 rounded-full ${DOT[stage]}`} />
                  {t.stages[stage]} <span className="text-muted">{board.data?.counts[stage] ?? 0}</span>
                </span>
                {column.map((r) => <Card key={r.id} r={r} selected={r.id === selectedId} to={`/staff/requests/${r.id}`} />)}
                {stage === "collected" && column.length < (board.data?.counts.collected ?? 0) && (
                  <button type="button" onClick={() => setCollected(collected + COLLECTED_STEP)} className="min-h-11 cursor-pointer rounded-full border border-line bg-white px-4 text-[13px] font-semibold">
                    {t.showOlder}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {selectedId && <DesktopPanel id={selectedId} staff={board.data?.staff ?? []} />}
      </div>
    </>
  );
}

function DesktopPanel({ id, staff }: { id: string; staff: Board["staff"] }) {
  const request = useRequest(id);
  const assign = useRequestMutation((body: { assigned_staff_id: string | null }) => staffApi<Request>(`/staff/print-requests/${id}`, json("PATCH", body)));
  if (!request.data) return null;
  const r = request.data;
  return (
    <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-3xl bg-white p-6">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex flex-col gap-1">
          <span className="font-heading text-[26px] font-semibold">{r.number} · {t.type[r.type]}</span>
          <span className="text-[13px] text-muted">{r.summary} · {t.due(day(r.needed_by))}</span>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-paper px-3 py-1.5 text-xs font-semibold"><span className={`size-2 rounded-full ${DOT[r.status]}`} />{t.stages[r.status]}</span>
      </div>
      <Customer r={r} />
      <Notes r={r} />
      <Files r={r} />
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        {t.assignedTo}
        <Select
          value={r.assigned_staff_id ?? ""}
          onChange={(id) => assign.mutate({ assigned_staff_id: id || null })}
          options={[{ value: "", label: t.nobody }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
        />
      </label>
      <Actions r={r} />
      <History r={r} />
    </div>
  );
}

function Customer({ r }: { r: Request }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-paper p-3.5 text-sm">
      <span className="font-semibold">{r.customer}{r.has_account && <span className="ml-2 rounded-full bg-sage px-2 py-0.5 text-[11px]">{t.hasAccount}</span>}</span>
      {r.phone && <a href={`tel:+250${r.phone.replace(/\D/g, "").slice(1)}`}>{r.phone}</a>}
      {r.email && <span className="text-muted">{r.email}</span>}
    </div>
  );
}

function Notes({ r }: { r: Request }) {
  const notes = String(r.details.notes ?? "").trim();
  if (!notes) return null;
  return (
    <div className="text-sm">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t.notes}</span>
      <p className="m-0 mt-1 whitespace-pre-line">{notes}</p>
    </div>
  );
}

function Files({ r }: { r: Request }) {
  const [error, setError] = useState<string | null>(null);
  const download = async (fileId: string, filename: string) => {
    setError(null);
    try {
      // Fetched with the staff token, so the file never has a public link.
      const url = URL.createObjectURL(await staffDownload(`/staff/print-requests/${r.id}/files/${fileId}`));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(strings.genericError);
    }
  };
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t.attached}</span>
      {r.files.length === 0 && <span className="text-muted">{t.noFiles}</span>}
      {r.files.map((f) => (
        <button key={f.id} type="button" onClick={() => download(f.id, f.filename)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-left font-medium">
          <icons.book size={16} />
          <span className="flex-1 truncate underline">{f.filename}</span>
          <span className="text-xs text-muted">{Math.max(1, Math.round(f.size_bytes / 1024))} KB</span>
        </button>
      ))}
      {error && <span role="alert" className="text-error">{error}</span>}
    </div>
  );
}

/** Quote box (new / quoted), then the next step with WhatsApp. */
function Actions({ r }: { r: Request }) {
  const [price, setPrice] = useState(r.quote_rwf?.toString() ?? "");
  const [readyOn, setReadyOn] = useState(r.ready_on ?? "");
  const [choosing, setChoosing] = useState(false);
  const [waError, setWaError] = useState<string | null>(null);
  useEffect(() => { setPrice(r.quote_rwf?.toString() ?? ""); setReadyOn(r.ready_on ?? ""); setChoosing(false); }, [r.id, r.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const quote = useRequestMutation((body: { quote_rwf: number; ready_on: string }) => staffApi<Request>(`/staff/print-requests/${r.id}/quote`, json("POST", body)));
  const advance = useRequestMutation((body: { paid_with?: string }) => staffApi<Request>(`/staff/print-requests/${r.id}/status`, json("POST", body)));
  const whatsapp = (template: "quote" | "ready" | "general") => openWhatsApp(r.id, template).catch((e) => setWaError(errorText(e)));
  const amount = Number(price);
  const preview = `Hello ${r.customer.split(" ")[0]}, your quote for ${r.summary} is ${amount > 0 ? formatRwf(amount) : "…"}.`;
  const field = "min-h-[46px] w-full rounded-xl border border-line bg-white px-3 text-[15px] font-medium";

  const sendQuote = async () => {
    // Save the quote, then open WhatsApp with it.
    const tab = window.open("", "_blank");
    try {
      await quote.mutateAsync({ quote_rwf: amount, ready_on: readyOn });
      const { url } = await staffApi<{ url: string }>(`/staff/print-requests/${r.id}/whatsapp-link`, json("POST", { template: "quote" }));
      if (tab) tab.location.href = url;
    } catch {
      tab?.close();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {(r.status === "new" || r.status === "quoted") && (
        <div className="flex flex-col gap-3 rounded-2xl bg-butter p-3.5">
          <span className="text-sm font-semibold">{t.quote}</span>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-xs font-semibold">{t.price}<input type="number" min={1} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} className={field} /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold">{t.readyOn}<input type="date" min={kigaliToday()} value={readyOn} onChange={(e) => setReadyOn(e.target.value)} className={field} /></label>
          </div>
          <span className="text-xs text-[#3C4A42]">{amount > 0 ? t.preview(preview) : t.enterPrice}</span>
          <button type="button" disabled={!(amount > 0) || !readyOn || quote.isPending} onClick={sendQuote} className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink text-sm font-semibold text-white disabled:opacity-50">
            <icons.phone size={16} />
            {t.sendQuote}
          </button>
          {quote.error && <span role="alert" className="text-sm text-error">{errorText(quote.error)}</span>}
        </div>
      )}
      {t.next[r.status] && (
        choosing ? (
          <div className="flex flex-col gap-2">
            <span className="text-center text-sm font-semibold">{t.collectHow}</span>
            <div className="flex gap-2">
              {(["cash", "mobile_money"] as const).map((m) => (
                <button key={m} type="button" disabled={advance.isPending} onClick={() => advance.mutate({ paid_with: m })} className="min-h-[50px] flex-1 cursor-pointer rounded-full bg-ink text-[15px] font-semibold text-white">
                  {m === "cash" ? strings.orders.cash : strings.orders.mobileMoney}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={advance.isPending}
            onClick={async () => {
              if (r.status === "ready") return setChoosing(true);
              await advance.mutateAsync({});
              if (r.status === "in_progress" && r.phone) whatsapp("ready");
            }}
            className="min-h-[50px] cursor-pointer rounded-full bg-ink text-[15px] font-semibold text-white"
          >
            {t.next[r.status]}
          </button>
        )
      )}
      {r.phone && r.status !== "new" && r.status !== "collected" && (
        <button type="button" onClick={() => whatsapp(r.status === "ready" ? "ready" : r.status === "quoted" ? "quote" : "general")} className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-sage text-sm font-semibold">
          <icons.phone size={16} />
          {strings.orders.whatsappGeneral}
        </button>
      )}
      {(advance.error || waError) && <span role="alert" className="text-sm text-error">{errorText(advance.error) ?? waError}</span>}
    </div>
  );
}

function History({ r }: { r: Request }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t.history}</span>
      {r.history.map((h, i) => (
        <div key={i} className="flex items-start gap-3 py-1.5 text-sm">
          <span className="mt-[5px] size-2.5 shrink-0 rounded-full bg-ink" />
          <span className="flex-1">
            <span className="font-semibold">{t.historyStep[h.event ?? h.status] ?? h.status}</span> <span className="text-muted">{strings.orders.by(h.who)}</span>
            {h.note && h.event !== "whatsapp_opened" && <span className="block text-[13px] text-muted">{h.note}</span>}
          </span>
          <span className="text-xs whitespace-nowrap text-muted">{time(h.at)}</span>
        </div>
      ))}
    </div>
  );
}

function NewRequestForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [kind, setKind] = useState<"invitations" | "binding">("invitations");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [quantity, setQuantity] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [details, setDetails] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("type", kind);
      form.set("name", name);
      form.set("phone", phone);
      if (neededBy) form.set("needed_by", neededBy);
      form.set(
        "details",
        JSON.stringify(kind === "invitations" ? { event: "Other", quantity: Number(quantity), notes: details } : { binding: "Spiral", copies: Number(quantity), notes: details }),
      );
      return staffApi<Request>("/staff/print-requests", { method: "POST", body: form });
    },
    onSuccess: (r) => {
      client.invalidateQueries({ queryKey: ["staff", "requests", "board"] });
      onDone();
      navigate(`/staff/requests/${r.id}`);
    },
  });
  const field = "min-h-[46px] w-full rounded-xl border border-line bg-white px-3.5 text-[15px] font-medium";
  return (
    <form className="flex flex-col gap-4 rounded-3xl border-2 border-ink bg-white p-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h2 className="m-0 font-body text-lg font-bold">{t.newTitle}</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.customer}<input value={name} onChange={(e) => setName(e.target.value)} className={field} required /></label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.phone}<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07X XXX XXXX" className={field} required /></label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
          {t.service}
          <Select
            value={kind}
            onChange={(v) => setKind(v as typeof kind)}
            options={[{ value: "invitations", label: strings.services.invitations }, { value: "binding", label: strings.services.binding }]}
            className={`${field} text-ink`}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.quantity}<input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={field} required /></label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.neededBy}<input type="date" min={kigaliToday()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={field} /></label>
      </div>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">{t.details}<textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} className="w-full rounded-xl border border-line px-3.5 py-3 text-sm" /></label>
      {save.error && <p role="alert" className="m-0 text-sm text-error">{errorText(save.error)}</p>}
      <div className="flex justify-end gap-2.5">
        <button type="button" onClick={onDone} className="min-h-11 cursor-pointer rounded-full border border-line bg-white px-[18px] text-sm font-semibold">{t.cancel}</button>
        <button type="submit" disabled={save.isPending} className="min-h-11 cursor-pointer rounded-full bg-ink px-5 text-sm font-semibold text-white">{t.save}</button>
      </div>
    </form>
  );
}

function MobileList() {
  const board = useBoard();
  const [stage, setStage] = useState<(typeof STAGES)[number]>("new");
  const items = (board.data?.items ?? []).filter((r) => r.status === stage);
  return (
    <div className="flex flex-col gap-3 pt-6">
      <h1 className="m-0 font-heading text-[26px] font-semibold">{t.title}</h1>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {STAGES.slice(0, 4).map((s) => (
          <button key={s} type="button" aria-pressed={stage === s} onClick={() => setStage(s)} className={`min-h-11 shrink-0 cursor-pointer rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap ${stage === s ? "border-ink bg-ink text-white" : "border-line bg-white"}`}>
            {t.stages[s]} <span className="opacity-75">{board.data?.counts[s] ?? 0}</span>
          </button>
        ))}
      </div>
      {items.length === 0 && <p className="py-8 text-center text-sm text-muted">{t.empty}</p>}
      {items.map((r) => <Card key={r.id} r={r} to={`/staff/requests/${r.id}`} />)}
    </div>
  );
}

function MobileDetail({ id }: { id: string }) {
  const request = useRequest(id);
  if (!request.data) return <p className="pt-6">{strings.staff.loading}</p>;
  const r = request.data;
  return (
    <div className="flex flex-col gap-3 pb-4">
      <header className="flex items-center gap-2.5 pt-6">
        <Link to="/staff/requests" aria-label={t.back} className="flex size-11 items-center justify-center rounded-full bg-white"><icons.back size={18} /></Link>
        <span className="flex flex-1 flex-col">
          <span className="font-heading text-2xl font-semibold">{r.number} · {t.type[r.type]}</span>
          <span className="text-xs text-muted">{r.customer} · {r.summary} · {t.due(day(r.needed_by))}</span>
        </span>
      </header>
      <Customer r={r} />
      <Notes r={r} />
      <Files r={r} />
      <div className="rounded-[20px] bg-white p-3.5"><Actions r={r} /></div>
      <div className="rounded-[20px] bg-white p-3.5"><History r={r} /></div>
    </div>
  );
}
