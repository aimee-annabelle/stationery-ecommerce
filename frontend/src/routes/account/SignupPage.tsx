// 8 · Sign up + email verification (design/Signup.dc.html): details, 6-digit code, done.

import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { icons } from "../../components/icons";
import { api, ApiError } from "../../lib/api";
import { useCustomerSession } from "../../lib/customerSession";
import { strings } from "../../strings";
import { ArchPoints, ArchTitle, AuthShell, CodeInput, Field, inputClass, PasswordInput, primaryButton } from "./AuthShell";

const t = strings.auth.signup;
const METER = ["bg-error", "bg-[#C9A227]", "bg-[#5E8C6A]", "bg-[#2F6B45]"];

function strength(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
  if (pw.length >= 12 || /[^a-zA-Z0-9]/.test(pw)) score++;
  return score;
}

export function SignupPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { verify, customer } = useCustomerSession();
  const verifyEmail = params.get("verify");
  const rawNext = params.get("next");
  // Only pages on this site, so a link can't send people elsewhere after signing up.
  const next = rawNext?.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;
  const [step, setStep] = useState<"form" | "verify" | "done">(verifyEmail ? "verify" : "form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(verifyEmail ?? "");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [code, setCode] = useState("");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOk = name.trim().length > 1;
  const phoneOk = phone.replace(/\D/g, "").length >= 9;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pwOk = password.length >= 8;
  const score = strength(password);
  const stepN = step === "form" ? 1 : step === "verify" ? 2 : 3;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : strings.genericError);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!(nameOk && phoneOk && emailOk && pwOk && terms)) return setError(t.missing);
    run(async () => {
      await api("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone, email: email.trim(), password, marketing_opt_in: false }),
      });
      setStep("verify");
      setTried(false);
    });
  };

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await verify(email.trim(), code);
      setStep("done");
    });
  };

  const resend = () =>
    run(async () => {
      await api("/auth/verify/resend", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setNotice(strings.auth.codeSent);
    });

  const h2 = "m-0 mb-2 font-heading text-[32px] font-medium sm:text-[40px]";
  const errorLine = error && <p role="alert" className="m-0 text-sm text-error">{error}</p>;
  const firstName = (customer?.name ?? name).split(" ")[0];

  return (
    <AuthShell
      arch={
        <>
          <ArchTitle start={t.joinTitle} accent={t.joinAccent} />
          <p className="m-0 max-w-[420px] text-base leading-relaxed">{t.joinText}</p>
          <ArchPoints points={t.perks} />
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">{t.step(stepN)}</span>
        <div className="flex gap-2" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-1.5 flex-1 rounded-[3px] ${n <= stepN ? "bg-ink" : "bg-[#E4E0D6]"}`} />
          ))}
        </div>
      </div>

      {step === "form" && (
        <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
          <div>
            <h2 className={h2}>{t.title}</h2>
            <span className="text-[15px] text-muted">
              {t.haveAccount}{" "}
              <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold underline">
                {strings.auth.loginTitle}
              </Link>
            </span>
          </div>
          <Field label={t.name}>
            <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass(tried && !nameOk)} />
          </Field>
          <Field label={t.phone}>
            <input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07X XXX XXXX" className={inputClass(tried && !phoneOk)} />
          </Field>
          <Field label={t.email}>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={strings.auth.emailPlaceholder} className={inputClass(tried && !emailOk)} />
          </Field>
          <Field label={t.password}>
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder={strings.auth.newPasswordPlaceholder} invalid={tried && !pwOk} />
            {password && (
              <span className="flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-[#EEEBE4]">
                  <span className={`block h-full transition-[width] ${METER[score]}`} style={{ width: `${(score + 1) * 25}%` }} />
                </span>
                <span className="text-xs font-semibold text-muted">{t.strength[score]}</span>
              </span>
            )}
          </Field>
          <button
            type="button"
            role="checkbox"
            aria-checked={terms}
            onClick={() => setTerms(!terms)}
            className="flex min-h-11 cursor-pointer items-center gap-3 text-left text-[15px] font-medium"
          >
            <span className={`flex size-[22px] shrink-0 items-center justify-center rounded-[7px] border-[1.5px] text-white ${terms ? "border-ink bg-ink" : tried ? "border-error bg-white" : "border-[#A9B3AC] bg-white"}`}>
              {terms && <icons.check size={14} />}
            </span>
            {t.terms}
          </button>
          {errorLine}
          <button type="submit" disabled={busy} className={primaryButton}>
            {t.submit}
          </button>
        </form>
      )}

      {step === "verify" && (
        <form className="flex flex-col gap-5" onSubmit={onVerify}>
          <div>
            <h2 className={h2}>{t.checkEmail}</h2>
            <span className="text-[15px] leading-relaxed text-muted">{t.codeIntro}</span>
            {email && <span className="mt-1 block text-[15px] font-semibold">{email}</span>}
          </div>
          <CodeInput value={code} onChange={setCode} label={t.code} />
          {errorLine}
          {notice && <p role="status" className="m-0 text-sm text-[#2F6B45]">{notice}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className={primaryButton}>
            {t.verify}
          </button>
          <div className="flex justify-between">
            <button type="button" onClick={() => { setStep("form"); setCode(""); }} className="min-h-11 cursor-pointer text-sm font-semibold underline">
              {t.changeEmail}
            </button>
            <button type="button" onClick={resend} disabled={busy} className="min-h-11 cursor-pointer text-sm font-semibold text-error">
              {strings.auth.resendCode}
            </button>
          </div>
        </form>
      )}

      {step === "done" && (
        <div role="status" className="flex flex-col items-start gap-4">
          <span className="flex size-[72px] items-center justify-center rounded-full bg-ink text-white">
            <icons.check size={32} />
          </span>
          <h2 className={h2}>{t.doneTitle(firstName)}</h2>
          <p className="m-0 text-base text-muted">{t.doneText}</p>
          <button type="button" onClick={() => navigate(next ?? "/shop")} className={primaryButton}>
            {t.start}
          </button>
        </div>
      )}
    </AuthShell>
  );
}
