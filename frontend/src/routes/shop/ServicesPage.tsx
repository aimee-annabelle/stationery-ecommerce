// 6 · Print & binding (design/Services.dc.html). Guests and signed-in customers send a request; staff reply
// with a price and a ready date on WhatsApp.

import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { icons } from "../../components/icons";
import { api, ApiError } from "../../lib/api";
import { customerToken, useCustomerSession } from "../../lib/customerSession";
import { formatPhone } from "../../lib/format";
import { strings } from "../../strings";

const t = strings.services;
type Kind = "invitations" | "binding";
const MAX_FILES = 3;
const MAX_BYTES = 20 * 1024 * 1024;

const kigaliToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali" }).format(new Date());
const input = (invalid = false) =>
  `min-h-[52px] w-full rounded-2xl bg-white px-4 text-base font-medium text-ink ${invalid ? "border-[1.5px] border-error" : "border border-line"}`;
const pill = (on: boolean) =>
  `min-h-11 cursor-pointer rounded-full border px-[18px] text-sm font-medium ${on ? "border-ink bg-ink text-white" : "border-line bg-white"}`;

export function ServicesPage() {
  const { customer } = useCustomerSession();
  const [kind, setKind] = useState<Kind>("invitations");
  const [name, setName] = useState(customer?.name ?? "");
  const [phone, setPhone] = useState(customer ? formatPhone(customer.phone) : "");
  useEffect(() => {
    // The session can finish loading after the first render; fill only empty fields.
    if (!customer) return;
    setName((v) => v || customer.name);
    setPhone((v) => v || formatPhone(customer.phone));
  }, [customer]);
  const [event, setEvent] = useState<string>(t.events[0]);
  const [quantity, setQuantity] = useState("");
  const [binding, setBinding] = useState<string>(t.bindings[0]);
  const [copies, setCopies] = useState("");
  const [pages, setPages] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("type", kind);
      form.set("name", name.trim());
      form.set("phone", phone);
      if (neededBy) form.set("needed_by", neededBy);
      form.set(
        "details",
        JSON.stringify(kind === "invitations" ? { event, quantity: Number(quantity), notes } : { binding, copies: Number(copies), pages: Number(pages) || null, notes }),
      );
      files.forEach((f) => form.append("files", f));
      return api<{ number: string; name: string; phone: string }>("/print-requests", { method: "POST", body: form }, customerToken());
    },
  });

  const nameOk = name.trim().length > 1;
  const phoneOk = phone.replace(/\D/g, "").length >= 9;
  const amountOk = kind === "invitations" ? Number(quantity) > 0 : Number(copies) > 0;

  const addFiles = (list: FileList | null) => {
    setFileError(null);
    const picked = Array.from(list ?? []);
    const tooBig = picked.find((f) => f.size > MAX_BYTES);
    if (tooBig) return setFileError(`${tooBig.name}: ${t.fileHint}`);
    setFiles([...files, ...picked].slice(0, MAX_FILES));
  };

  const reset = () => {
    send.reset();
    setQuantity("");
    setCopies("");
    setPages("");
    setNotes("");
    setFiles([]);
    setTried(false);
  };

  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-8 rounded-card-lg bg-ink p-7 text-white sm:p-14">
          <div className="flex flex-[1_1_480px] flex-col gap-4">
            <span className="text-sm font-semibold text-[#CFDCD3]">{t.kicker}</span>
            <h1 className="m-0 font-heading text-[44px] leading-[1.02] font-medium sm:text-[64px]">
              {t.title} <em className="text-sage">{t.titleAccent}</em>
            </h1>
            <p className="m-0 max-w-[520px] text-[17px] leading-[1.65] text-[#CFDCD3]">{t.intro}</p>
          </div>
          <ol className="m-0 flex list-none flex-col gap-3 p-0 text-[15px]">
            {t.steps.map((step, i) => (
              <li key={step} className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-sage font-bold text-ink">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pt-10 pb-24 sm:px-6">
        <div role="tablist" aria-label={t.tabsLabel} className="mb-6 flex flex-wrap gap-3">
          {(["invitations", "binding"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => { setKind(k); send.reset(); }}
              className={`min-h-[52px] cursor-pointer rounded-full border px-6 text-base font-semibold ${kind === k ? "border-ink bg-ink text-white" : "border-line bg-white"}`}
            >
              {k === "invitations" ? t.invitations : t.binding}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-8">
          <div className="flex flex-[1_1_340px] flex-col gap-[18px]">
            <div className={`flex flex-col gap-4 rounded-[32px] p-8 ${kind === "invitations" ? "bg-blush" : "bg-sage"}`}>
              {kind === "invitations" ? <icons.mail size={34} /> : <icons.book size={34} />}
              <h2 className="m-0 font-heading text-[34px] font-medium">{kind === "invitations" ? t.invitations : t.binding}</h2>
              <p className="m-0 text-[15px] leading-[1.65]">{kind === "invitations" ? t.invText : t.bindText}</p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[15px]">
                {(kind === "invitations" ? t.invFacts : t.bindFacts).map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl bg-white px-6 py-5 text-[15px] leading-relaxed">
              {t.talk}{" "}
              <a href={strings.shop.phoneHref} className="font-semibold underline">{strings.shop.phone}</a> {t.talkEnd}
            </div>
          </div>

          <div className="min-w-0 flex-[999_1_560px]">
            {send.data ? (
              <div role="status" className="flex flex-col items-start gap-4 rounded-[32px] bg-white p-8 sm:p-12">
                <span className="flex size-[72px] items-center justify-center rounded-full bg-ink text-white">
                  <icons.check size={32} />
                </span>
                <h2 className="m-0 font-heading text-[40px] font-medium">{t.sentTitle}</h2>
                <p className="m-0 max-w-[520px] text-base leading-[1.65] text-[#3C4A42]">{t.sentText(send.data.number, send.data.name, send.data.phone)}</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={reset} className="min-h-[52px] cursor-pointer rounded-full border-[1.5px] border-ink px-6 text-[15px] font-semibold">{t.another}</button>
                  <Link to={customer ? "/account?tab=requests" : "/signup"} className="flex min-h-[52px] items-center rounded-full bg-ink px-6 text-[15px] font-semibold text-white no-underline">
                    {customer ? t.seeAccount : t.follow}
                  </Link>
                </div>
              </div>
            ) : (
              <form
                className="flex flex-col gap-5 rounded-[32px] bg-white p-6 sm:p-9"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  setTried(true);
                  if (nameOk && phoneOk && amountOk) send.mutate();
                }}
              >
                <h2 className="m-0 font-heading text-[32px] font-medium">{t.formTitle[kind]}</h2>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-4">
                  <label className="flex flex-col gap-2 text-sm font-semibold">{t.name}<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.namePlaceholder} className={input(tried && !nameOk)} /></label>
                  <label className="flex flex-col gap-2 text-sm font-semibold">{t.phone}<input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.phonePlaceholder} className={input(tried && !phoneOk)} /></label>
                </div>

                {kind === "invitations" ? (
                  <>
                    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
                      <legend className="mb-2.5 text-sm font-semibold">{t.event}</legend>
                      <div role="radiogroup" className="flex flex-wrap gap-2">
                        {t.events.map((ev) => (
                          <button key={ev} type="button" role="radio" aria-checked={event === ev} onClick={() => setEvent(ev)} className={pill(event === ev)}>{ev}</button>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-4">
                      <label className="flex flex-col gap-2 text-sm font-semibold">{t.quantity}<input type="number" min={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={input(tried && !amountOk)} /></label>
                      <label className="flex flex-col gap-2 text-sm font-semibold">{t.neededBy}<input type="date" min={kigaliToday()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={input()} /></label>
                    </div>
                  </>
                ) : (
                  <>
                    <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
                      <legend className="mb-2.5 text-sm font-semibold">{t.bindingType}</legend>
                      <div role="radiogroup" className="flex flex-wrap gap-2">
                        {t.bindings.map((b) => (
                          <button key={b} type="button" role="radio" aria-checked={binding === b} onClick={() => setBinding(b)} className={pill(binding === b)}>{b}</button>
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-4">
                      <label className="flex flex-col gap-2 text-sm font-semibold">{t.copies}<input type="number" min={1} inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} className={input(tried && !amountOk)} /></label>
                      <label className="flex flex-col gap-2 text-sm font-semibold">{t.pages}<input type="number" min={1} inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value)} className={input()} /></label>
                      <label className="flex flex-col gap-2 text-sm font-semibold">{t.neededBy}<input type="date" min={kigaliToday()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={input()} /></label>
                    </div>
                  </>
                )}

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-semibold">
                    {t.file[kind]} <span className="font-normal text-muted">{t.optional}</span>
                  </span>
                  <label className="flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[20px] border-[1.5px] border-dashed border-[#A9B3AC] bg-paper p-4 text-center text-sm font-semibold focus-within:outline-2 focus-within:outline-ink">
                    <icons.photo size={24} />
                    {t.chooseFiles}
                    <span className="text-xs font-normal text-muted">{t.fileHint}</span>
                    <input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="sr-only" disabled={files.length >= MAX_FILES} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                  </label>
                  {files.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {files.map((f, i) => (
                        <li key={`${f.name}${i}`} className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-sm">
                          <span className="truncate">{f.name}</span>
                          <button type="button" aria-label={t.removeFile(f.name)} onClick={() => setFiles(files.filter((_, n) => n !== i))} className="flex size-9 cursor-pointer items-center justify-center rounded-full">
                            <icons.close size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {fileError && <span role="alert" className="text-sm text-error">{fileError}</span>}
                </div>

                <label className="flex flex-col gap-2 text-sm font-semibold">
                  {t.notes[kind]}
                  <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t.notesHint[kind]} className="w-full rounded-2xl border border-line bg-white px-4 py-3 text-base font-medium" />
                </label>
                {tried && (!nameOk || !phoneOk) && <p role="alert" className="m-0 text-sm text-error">{t.missing}</p>}
                {send.error && <p role="alert" className="m-0 text-sm text-error">{send.error instanceof ApiError ? send.error.message : strings.genericError}</p>}
                <button type="submit" disabled={send.isPending} className="min-h-14 cursor-pointer self-start rounded-full bg-ink px-8 text-base font-semibold text-white disabled:opacity-60">
                  {send.isPending ? t.sending : t.send}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
