// Staff log-in. Not designed yet, so it reuses the customer log-in layout (design/Login.dc.html).

import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { icons } from "../../components/icons";
import { ApiError } from "../../lib/api";
import { useStaffSession } from "../../lib/staffSession";
import { strings } from "../../strings";
import "../../styles/login.css";

const t = strings.staff.login;

export function StaffLogin() {
  const { status, login } = useStaffSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="login-page">
      <header className="login-header">
        <span className="login-logo">
          Pahyems<span>.</span>
        </span>
      </header>
      <section className="login-section">
        <div className="login-arch">
          <h1>
            {t.welcome} <em>{t.welcomeAccent}</em>
          </h1>
          <ul>
            {t.points.map((point) => (
              <li key={point}>
                <span aria-hidden="true">✓</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <form className="login-card" onSubmit={onSubmit} noValidate>
          <div>
            <h2>{t.title}</h2>
            <p>{t.intro}</p>
          </div>
          <label className="login-field">
            {t.email}
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!error}
            />
          </label>
          <label className="login-field">
            {t.password}
            <span className="login-password">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!error}
              />
              <button
                type="button"
                aria-label={showPassword ? t.hidePassword : t.showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                <icons.eye />
              </button>
            </span>
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="login-submit" type="submit" disabled={busy}>
            {t.submit}
          </button>
        </form>
      </section>
    </div>
  );
}
