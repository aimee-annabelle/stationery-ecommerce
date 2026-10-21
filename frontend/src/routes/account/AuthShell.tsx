// Layout from design/Login.dc.html and design/Signup.dc.html: arch panel on the left, white card on the right.
// Used by customer log-in, sign-up and password reset, and by the staff log-in.

import { useState } from "react";
import { Link } from "react-router-dom";
import { icons } from "../../components/icons";
import { strings } from "../../strings";

export function AuthShell({
  arch,
  children,
  guestLink = true,
}: {
  arch: React.ReactNode;
  children: React.ReactNode;
  guestLink?: boolean;
}) {
  return (
    <div className="min-h-screen bg-paper font-body text-ink">
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 py-[22px] sm:px-6">
        <Link to="/" className="font-heading text-[28px] font-bold no-underline">
          Pahyems<span className="text-terracotta">.</span>
        </Link>
        {guestLink && (
          <Link to="/shop" className="py-3 text-[15px] font-semibold underline">
            {strings.auth.continueGuest}
          </Link>
        )}
      </header>
      <section className="mx-auto flex max-w-[1240px] flex-wrap items-stretch gap-5 px-4 pt-2 pb-12 sm:gap-10 sm:px-6 sm:pt-4 sm:pb-24">
        <div className="flex flex-[1_1_440px] flex-col justify-end gap-[22px] rounded-[999px_999px_40px_40px] bg-sage px-7 pt-24 pb-8 sm:min-h-[620px] sm:px-12 sm:pt-[140px] sm:pb-12">
          {arch}
        </div>
        <div className="flex flex-[1_1_420px] flex-col justify-center gap-[22px] rounded-[28px] bg-white px-5 py-7 sm:rounded-card-lg sm:p-12">
          {children}
        </div>
      </section>
    </div>
  );
}

export function ArchTitle({ start, accent }: { start: string; accent: string }) {
  return (
    <h1 className="m-0 font-heading text-[40px] leading-[1.04] font-medium sm:text-[56px]">
      {start} <em className="text-terracotta">{accent}</em>
    </h1>
  );
}

export function ArchPoints({ points }: { points: readonly string[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-base">
      {points.map((point) => (
        <li key={point} className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-white">
            <icons.check size={16} />
          </span>
          {point}
        </li>
      ))}
    </ul>
  );
}

export const inputClass = (invalid = false) =>
  `min-h-[54px] w-full rounded-2xl bg-white px-4 text-base font-medium text-ink ${invalid ? "border-[1.5px] border-error" : "border border-line"}`;

export function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <label className="flex flex-col gap-2 text-sm font-semibold">{label}{children}</label>;
}

export function PasswordInput({
  value,
  onChange,
  autoComplete,
  placeholder,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative flex">
      <input
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid}
        className={`${inputClass(invalid)} pr-14`}
      />
      <button
        type="button"
        aria-label={show ? strings.auth.hidePassword : strings.auth.showPassword}
        onClick={() => setShow(!show)}
        className="absolute top-1/2 right-1.5 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl text-muted"
      >
        <icons.eye />
      </button>
    </span>
  );
}

export const primaryButton =
  "min-h-14 w-full cursor-pointer rounded-full bg-ink text-base font-semibold text-white disabled:cursor-default disabled:opacity-60";
export const outlineButton =
  "flex min-h-14 w-full items-center justify-center rounded-full border-[1.5px] border-ink text-base font-semibold no-underline";

export function CodeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="min-h-[60px] w-full rounded-2xl border border-line px-4 text-2xl font-semibold tracking-[0.4em]"
      />
    </Field>
  );
}
