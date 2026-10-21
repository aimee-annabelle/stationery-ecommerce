// /staff/invite?token=… — an invited staff member chooses a password (S7 invite). Same layout as log-in.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { strings } from "../../strings";
import { ArchTitle, AuthShell, Field, PasswordInput, primaryButton } from "../account/AuthShell";

const t = strings.invite;

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const who = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<{ name: string; email: string; role: string }>(`/staff/auth/invite?token=${encodeURIComponent(token)}`),
    enabled: !!token,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => api("/staff/auth/accept-invite", { method: "POST", body: JSON.stringify({ token, password }) }),
    // A full load, so the staff session picks up the new refresh cookie.
    onSuccess: () => window.location.assign("/staff"),
  });

  return (
    <AuthShell guestLink={false} arch={<ArchTitle start={strings.staff.login.welcome} accent="aboard." />}>
      <div className="flex flex-col gap-[22px]">
        <h2 className="m-0 font-heading text-[32px] font-medium sm:text-[40px]">{t.title}</h2>
        {(who.error || !token) && (
          <>
            <p role="alert" className="m-0 text-sm text-error">{t.invalid}</p>
            <Link to="/staff/login" className="font-semibold underline">{strings.staff.login.submit}</Link>
          </>
        )}
        {who.data && (
          <form className="flex flex-col gap-[22px]" onSubmit={(e) => { e.preventDefault(); accept.mutate(); }}>
            <div>
              <p className="m-0 text-lg font-semibold">{t.hello(who.data.name)}</p>
              <p className="m-0 text-[15px] text-muted">{t.intro(strings.staff.roles[who.data.role as "worker"].toLowerCase())}</p>
              <p className="m-0 text-[15px] text-muted">{who.data.email}</p>
            </div>
            <Field label={t.password}>
              <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" placeholder={strings.auth.newPasswordPlaceholder} />
            </Field>
            {accept.error && <p role="alert" className="m-0 text-sm text-error">{accept.error instanceof ApiError ? accept.error.message : strings.genericError}</p>}
            <button type="submit" disabled={accept.isPending || password.length < 8} className={primaryButton}>{t.submit}</button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
