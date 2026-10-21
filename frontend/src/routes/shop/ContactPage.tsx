// 9 · Contact & FAQ (design/Contact.dc.html).

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { icons } from "../../components/icons";
import { api, ApiError } from "../../lib/api";
import { strings } from "../../strings";

const t = strings.contact;
const input = (invalid = false) =>
  `min-h-[52px] w-full rounded-2xl bg-white px-4 text-base font-medium text-ink ${invalid ? "border-[1.5px] border-error" : "border border-line"}`;

export function ContactPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [tried, setTried] = useState(false);
  const [open, setOpen] = useState(0);
  const send = useMutation({
    mutationFn: () => api("/contact", { method: "POST", body: JSON.stringify({ name: name.trim(), phone, message: message.trim() }) }),
  });
  const nameOk = name.trim().length > 1;
  const phoneOk = phone.replace(/\D/g, "").length >= 9;

  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pt-4 pb-12 sm:px-6">
        <h1 className="m-0 mb-8 font-heading text-[48px] leading-none font-medium sm:text-[64px]">
          {t.title} <em className="text-terracotta">{t.titleAccent}</em>
        </h1>
        <div className="flex flex-wrap items-stretch gap-6">
          <div className="flex flex-[1_1_340px] flex-col gap-4">
            {[
              [<icons.pin size={20} />, t.visit, strings.shop.address, null],
              [<icons.phone size={20} />, t.call, strings.shop.phone, strings.shop.phoneHref],
              [<icons.clock size={20} />, t.hours, strings.shop.hours, null],
            ].map(([icon, label, value, href]) => (
              <div key={label as string} className="flex items-center gap-4 rounded-3xl bg-white p-5">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sage">{icon}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] text-muted">{label}</span>
                  {href ? <a href={href as string} className="text-lg font-semibold no-underline">{value}</a> : <span className="text-lg font-semibold">{value}</span>}
                </span>
              </div>
            ))}
            <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-2 rounded-[28px] bg-lilac p-6 text-center">
              <icons.pin size={28} />
              <span className="font-semibold">{t.mapLabel}</span>
              <span className="text-sm text-muted">{t.map}</span>
            </div>
          </div>

          <div className="min-w-0 flex-[1_1_440px]">
            {send.isSuccess ? (
              <div role="status" className="flex h-full flex-col items-start justify-center gap-4 rounded-[32px] bg-white p-8 sm:p-12">
                <span className="flex size-[72px] items-center justify-center rounded-full bg-ink text-white"><icons.check size={32} /></span>
                <h2 className="m-0 font-heading text-[36px] font-medium">{t.sentTitle}</h2>
                <p className="m-0 text-base text-muted">{t.sentText}</p>
                <button type="button" onClick={() => { send.reset(); setMessage(""); setTried(false); }} className="min-h-[52px] cursor-pointer rounded-full border-[1.5px] border-ink px-6 text-[15px] font-semibold">{t.another}</button>
              </div>
            ) : (
              <form
                className="flex flex-col gap-5 rounded-[32px] bg-white p-6 sm:p-9"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  setTried(true);
                  if (nameOk && phoneOk && message.trim()) send.mutate();
                }}
              >
                <h2 className="m-0 font-heading text-[32px] font-medium">{t.formTitle}</h2>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4">
                  <label className="flex flex-col gap-2 text-sm font-semibold">{t.name}<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={input(tried && !nameOk)} /></label>
                  <label className="flex flex-col gap-2 text-sm font-semibold">{t.phone}<input type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07X XXX XXXX" className={input(tried && !phoneOk)} /></label>
                </div>
                <label className="flex flex-col gap-2 text-sm font-semibold">
                  {t.message}
                  <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} className={`w-full rounded-2xl bg-white px-4 py-3 text-base font-medium ${tried && !message.trim() ? "border-[1.5px] border-error" : "border border-line"}`} />
                </label>
                {tried && (!nameOk || !phoneOk) && <p role="alert" className="m-0 text-sm text-error">{t.missing}</p>}
                {send.error && <p role="alert" className="m-0 text-sm text-error">{send.error instanceof ApiError ? send.error.message : strings.genericError}</p>}
                <button type="submit" disabled={send.isPending} className="min-h-14 cursor-pointer self-start rounded-full bg-ink px-8 text-base font-semibold text-white disabled:opacity-60">{t.send}</button>
              </form>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-4 pb-24 sm:px-6">
        <h2 className="m-0 mb-6 font-heading text-[34px] font-medium sm:text-[44px]">{t.faqTitle}</h2>
        <div className="flex flex-col gap-3">
          {t.faq.map(([q, a], i) => (
            <div key={q} className="rounded-3xl bg-white">
              <button
                type="button"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? -1 : i)}
                className="flex min-h-16 w-full cursor-pointer items-center justify-between gap-4 px-6 py-4 text-left text-[17px] font-semibold"
              >
                {q}
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-transform ${open === i ? "rotate-45 bg-ink text-white" : "bg-paper"}`}>
                  <icons.plus size={16} />
                </span>
              </button>
              {open === i && <p className="m-0 px-6 pb-5 text-[15px] leading-relaxed text-[#3C4A42]">{a}</p>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
