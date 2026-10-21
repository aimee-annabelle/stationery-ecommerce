import { Outlet } from "react-router-dom";

// Staff back office. The sidebar (desktop) and bottom tab bar (phone) are built in stage 4.
export function StaffLayout() {
  return (
    <div className="staff-area">
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
