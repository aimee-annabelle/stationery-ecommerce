// Staff log-in. Not designed yet, so it reuses the customer log-in layout (design/Login.dc.html).

import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { useStaffSession } from "../../lib/staffSession";
import { strings } from "../../strings";
import { ArchPoints, ArchTitle, AuthShell, Field, inputClass, PasswordInput, primaryButton } from "../account/AuthShell";

const t = strings.staff.login;

export function StaffLogin() {
  const { status, login } = useStaffSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = params.get("next")?.startsWith("/staff") ? params.get("next")! : "/staff";
  if (status === "signedIn") return <Navigate to={next} replace />;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError(t.missing);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : strings.genericError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell guestLink={false} arch={<><ArchTitle start={t.welcome} accent={t.welcomeAccent} /><ArchPoints points={t.points} /></>}>
      <form className="flex flex-col gap-[22px]" onSubmit={onSubmit} noValidate>
        <div>
          <h2 className="m-0 mb-2 font-heading text-[32px] font-medium sm:text-[40px]">{t.title}</h2>
          <p className="m-0 text-[15px] text-muted">{t.intro}</p>
        </div>
        <Field label={t.email}>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} className={inputClass(!!error)} />
        </Field>
        <Field label={t.password}>
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} />
        </Field>
        {error && <p role="alert" className="m-0 text-sm text-error">{error}</p>}
        <button className={primaryButton} type="submit" disabled={busy}>
          {t.submit}
        </button>
      </form>
    </AuthShell>
  );
}
