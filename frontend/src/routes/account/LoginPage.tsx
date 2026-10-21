// 7 · Log in / reset password (design/Login.dc.html). Email only: there is no free way to send SMS codes.

import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { icons } from "../../components/icons";
import { api, ApiError } from "../../lib/api";
import { useCustomerSession } from "../../lib/customerSession";
import { strings } from "../../strings";
import { ArchPoints, ArchTitle, AuthShell, CodeInput, Field, inputClass, outlineButton, PasswordInput, primaryButton } from "./AuthShell";

const t = strings.auth;
const message = (error: unknown) => (error instanceof ApiError ? error.message : strings.genericError);

export function LoginPage({ startWith = "login" }: { startWith?: "login" | "forgot" }) {
  const { status, login } = useCustomerSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") && !params.get("next")?.startsWith("//") ? params.get("next")! : "/account";

  const [mode, setMode] = useState<"login" | "forgot" | "code">(startWith);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "signedIn") return <Navigate to={next} replace />;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const onLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError(t.missing);
    run(async () => {
      try {
        await login(email.trim(), password);
        navigate(next, { replace: true });
      } catch (err) {
        if (err instanceof ApiError && err.code === "email_not_verified") {
          navigate(`/signup?verify=${encodeURIComponent(email.trim())}`);
          return;
        }
        throw err;
      }
    });
  };

  const sendCode = () =>
    run(async () => {
      await api("/auth/reset/request", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setMode("code");
      setNotice(mode === "code" ? t.codeSent : null);
    });

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api("/auth/reset/confirm", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), code, new_password: password }),
      });
      await login(email.trim(), password);
      navigate(next, { replace: true });
    });
  };

  const h2 = "m-0 mb-2 font-heading text-[32px] font-medium sm:text-[40px]";
  const errorLine = error && (
    <p role="alert" className="m-0 text-sm text-error">
      {error}
    </p>
  );

  return (
    <AuthShell
      arch={
        <>
          <ArchTitle start={t.welcome} accent={t.welcomeAccent} />
          <ArchPoints points={t.points} />
        </>
      }
    >
      {mode === "login" && (
        <form className="flex flex-col gap-[22px]" onSubmit={onLogin} noValidate>
          <div>
            <h2 className={h2}>{t.loginTitle}</h2>
            <span className="text-[15px] text-muted">
              {t.newHere}{" "}
              <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold underline">
                {t.createAccount}
              </Link>
            </span>
          </div>
          <Field label={t.email}>
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.emailPlaceholder} className={inputClass(!!error)} />
          </Field>
          <label className="flex flex-col gap-2 text-sm font-semibold">
            <span className="flex items-center justify-between">
              {t.password}
              <button type="button" onClick={() => { setMode("forgot"); setError(null); }} className="min-h-8 cursor-pointer text-sm font-semibold text-error">
                {t.forgot}
              </button>
            </span>
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" placeholder={t.passwordPlaceholder} invalid={!!error} />
          </label>
          {errorLine}
          <button type="submit" disabled={busy} className={primaryButton}>
            {t.submit}
          </button>
          <div className="flex items-center gap-3.5 text-[13px] text-muted">
            <span className="h-px flex-1 bg-[#EEEBE4]" />
            {t.or}
            <span className="h-px flex-1 bg-[#EEEBE4]" />
          </div>
          <Link to="/shop" className={outlineButton}>
            {t.continueGuest}
          </Link>
        </form>
      )}

      {mode === "forgot" && (
        <form className="flex flex-col gap-[22px]" onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
          <button type="button" onClick={() => setMode("login")} className="flex min-h-11 cursor-pointer items-center gap-2 self-start text-[15px] font-semibold">
            <icons.arrowLeft size={16} />
            {t.backToLogin}
          </button>
          <div>
            <h2 className={h2}>{t.resetTitle}</h2>
            <span className="text-[15px] leading-relaxed text-muted">{t.resetIntro}</span>
          </div>
          <Field label={t.email}>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.emailPlaceholder} className={inputClass()} required />
          </Field>
          {errorLine}
          <button type="submit" disabled={busy || !email.trim()} className={primaryButton}>
            {t.sendCode}
          </button>
        </form>
      )}

      {mode === "code" && (
        <form className="flex flex-col gap-[22px]" onSubmit={onReset}>
          <div>
            <h2 className={h2}>{t.checkEmail}</h2>
            <span className="text-[15px] leading-relaxed text-muted">{t.codeIntro}</span>
          </div>
          <CodeInput value={code} onChange={setCode} label={t.resetCode} />
          <Field label={t.newPassword}>
            <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder={t.newPasswordPlaceholder} />
          </Field>
          {errorLine}
          {notice && <p role="status" className="m-0 text-sm text-[#2F6B45]">{notice}</p>}
          <button type="submit" disabled={busy || code.length !== 6 || password.length < 8} className={primaryButton}>
            {t.saveAndLogin}
          </button>
          <button type="button" onClick={sendCode} disabled={busy} className="min-h-11 cursor-pointer self-center text-sm font-semibold text-error">
            {t.resendCode}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
