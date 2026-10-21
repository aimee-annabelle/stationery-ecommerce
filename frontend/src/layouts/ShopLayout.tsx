import { Outlet } from "react-router-dom";

// Public shop and customer account pages. The header and footer from the canvas are built in stage 3.
export function ShopLayout() {
  return (
    <main className="page">
      <Outlet />
    </main>
  );
}
