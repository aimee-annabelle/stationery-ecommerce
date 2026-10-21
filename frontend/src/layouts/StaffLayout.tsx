import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { icons } from "../components/icons";
import { type Capability, useStaffSession } from "../lib/staffSession";
import { strings } from "../strings";
import "../styles/staff.css";

const t = strings.staff;

// Sidebar from the S1-S8 designs. Pages a role can't use are left out of its menu.
const NAV: { to: string; label: string; icon: keyof typeof icons; capability?: Capability; end?: boolean }[] = [
  { to: "/staff", label: t.nav.dashboard, icon: "grid", end: true },
  { to: "/staff/orders", label: t.nav.orders, icon: "bag" },
  { to: "/staff/requests", label: t.nav.requests, icon: "print" },
  { to: "/staff/products", label: t.nav.products, icon: "box", capability: "products.view" },
  { to: "/staff/reports", label: t.nav.reports, icon: "chart", capability: "reports.view" },
  { to: "/staff/activity", label: t.nav.activity, icon: "clock", capability: "activity.view" },
  { to: "/staff/team", label: t.nav.team, icon: "users", capability: "staff.manage" },
  { to: "/staff/settings", label: t.nav.settings, icon: "gear", capability: "settings.manage" },
];

// Bottom tab bar from the M1-M5 designs; the owner's from M6.
const OWNER_TABS: { to: string; label: string; icon: keyof typeof icons; end?: boolean }[] = [
  { to: "/staff", label: strings.pocket.tabs.home, icon: "home", end: true },
  { to: "/staff/reports", label: strings.pocket.tabs.reports, icon: "chart" },
  { to: "/staff/team", label: strings.pocket.tabs.staff, icon: "users" },
  { to: "/staff/settings", label: strings.pocket.tabs.settings, icon: "gear" },
];
const TABS: { to: string; label: string; icon: keyof typeof icons; end?: boolean }[] = [
  { to: "/staff", label: t.tabs.home, icon: "home", end: true },
  { to: "/staff/sale", label: t.tabs.sale, icon: "bag" },
  { to: "/staff/products", label: t.tabs.products, icon: "box" },
  { to: "/staff/requests", label: t.tabs.requests, icon: "print" },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function StaffLayout() {
  const { staff, status, can, logout } = useStaffSession();
  const location = useLocation();
  const navigate = useNavigate();

  if (status === "loading") return <p className="page">{t.loading}</p>;
  if (!staff) return <Navigate to={`/staff/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  const onLogout = async () => {
    await logout();
    navigate("/staff/login", { replace: true });
  };

  const navLink = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-[46px] items-center gap-3 rounded-[14px] px-3.5 text-[15px] font-medium no-underline ${
      isActive ? "bg-sage text-ink" : "text-[#E7EEE9] hover:bg-white/10"
    }`;
  const tabLink = ({ isActive }: { isActive: boolean }) =>
    `group flex min-h-[54px] flex-col items-center justify-center gap-1 text-[11px] no-underline ${
      isActive ? "font-bold text-ink" : "font-semibold text-muted"
    }`;

  return (
    <div className="min-h-screen bg-paper pb-24 font-body text-ink md:bg-paper-staff md:p-4 md:pl-[272px]">
      {/* Desktop: fixed, full-height sidebar (S1-S8). Hidden on phones. */}
      <aside className="fixed top-4 bottom-4 left-4 hidden w-60 flex-col gap-7 rounded-[28px] bg-ink px-3.5 py-6 text-white md:flex">
        <div className="flex items-center justify-between px-2.5">
          <span className="font-heading text-[26px] font-bold">
            Pahyems<span className="text-[#E8A48F]">.</span>
          </span>
          <span className="rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-bold tracking-[0.1em] uppercase">
            {t.badge}
          </span>
        </div>
        <nav className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1" aria-label={t.badge}>
          {NAV.filter((item) => !item.capability || can(item.capability)).map((item) => {
            const Icon = icons[item.icon];
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLink}>
                <Icon />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 rounded-card-sm bg-white/8 p-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sage text-sm font-bold text-ink">
            {initials(staff.name)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{staff.name}</span>
            <span className="text-xs text-[#CFDCD3]">{t.roles[staff.role]}</span>
          </span>
          <button
            className="flex size-11 cursor-pointer items-center justify-center rounded-xl text-white hover:bg-white/10"
            type="button"
            aria-label={t.logOut}
            onClick={onLogout}
          >
            <icons.logout size={18} />
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-col gap-[18px] px-4 pb-4 md:p-0">
        <Outlet />
      </main>

      {/* Phone: bottom tab bar instead of the sidebar (M1-M6). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-4 border-t border-[#E4E0D6] bg-white px-2 pt-1.5 pb-[max(16px,env(safe-area-inset-bottom))] md:hidden"
        aria-label="Main"
      >
        {(staff.role === "owner" ? OWNER_TABS : TABS).map((tab) => {
          const Icon = icons[tab.icon];
          return (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={tabLink}>
              <span className="flex h-[30px] w-[52px] items-center justify-center rounded-[15px] group-aria-[current=page]:bg-sage">
                <Icon />
              </span>
              {tab.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
